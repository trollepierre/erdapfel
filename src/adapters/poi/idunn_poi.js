import Poi from './poi';
import Ajax from '../../libs/ajax';
import nconf from '@qwant/nconf-getter';
import Error from '../../adapters/error';
import {sources} from '../../../config/constants.yml';
import Telemetry from '../../libs/telemetry';

const serviceConfig = nconf.get().services;
const LNG_INDEX = 0;
const LAT_INDEX = 1;


export default class IdunnPoi extends Poi {
  constructor(rawPoi) {
    let alternativeName = '';
    if (rawPoi.address) {
      if (rawPoi.address.label) {
        alternativeName = rawPoi.address.label;
      } else if (rawPoi.address.street && rawPoi.address.street.label) {
        alternativeName = rawPoi.address.street.label;
      }
    }
    let latLng = {
      lat: rawPoi.geometry.coordinates[LAT_INDEX],
      lng: rawPoi.geometry.coordinates[LNG_INDEX],
    };
    super(rawPoi.id, rawPoi.name, alternativeName, rawPoi.type, latLng, rawPoi.class_name,
      rawPoi.subclass_name);
    this.blocks = rawPoi.blocks;
    this.localName = rawPoi.local_name;
    this.address = IdunnPoi.getAddress(rawPoi);
    this.bbox = rawPoi.geometry.bbox;
    this.meta = rawPoi.meta || {};

    this.blocksByType = {};
    if (this.blocks) {
      this.blocksByType = Object.assign({}, ...this.blocks.map(b => ({[b.type]: b})));
      const imagesBlock = this.blocksByType.images;
      if (imagesBlock && imagesBlock.images.length > 0) {
        this.topImageUrl = imagesBlock.images[0].url;
      }
    }
  }

  getInputValue() {
    switch (this.type) {
    case 'address':
    case 'street':
      return this.alternativeName;
    default:
      return this.name;
    }
  }
  /* ?bbox={bbox}&category=<category-name>&size={size}&verbosity=long/ */
  static async poiCategoryLoad(bbox, size, category, query) {
    let url = `${serviceConfig.idunn.url}/v1/places`;
    let requestParams = {bbox, size};
    if (category) {
      requestParams['category'] = category;
    }
    if (query) {
      requestParams['q'] = query;
    }

    try {
      let response = await Ajax.getLang(url, requestParams);
      response.places = response.places.map((rawPoi) => new IdunnPoi(rawPoi));
      return response;
    } catch (err) {
      if (err === 400 || err === 404) {
        return {};
      } else {
        let s_requestParams = JSON.stringify(requestParams);
        Error.sendOnce(
          'idunn_poi', 'poiApiLoad',
          `unknown error getting idunn poi reaching ${url} with options ${s_requestParams}`,
          err
        );
        return {};
      }
    }
  }

  static async poiApiLoad(id, options = {}) {
    let rawPoi = null;
    let url = `${serviceConfig.idunn.url}/v1/places/${id}`;
    let requestParams = {};
    if (options.simple) {
      requestParams = {verbosity: 'short'};
    }
    try {
      rawPoi = await Ajax.getLang(url, requestParams);
      return new IdunnPoi(rawPoi);
    } catch (err) {
      if (err === 404) {
        return;
      } else {
        let s_requestParams = JSON.stringify(requestParams);
        Error.sendOnce(
          'idunn_poi', 'poiApiLoad',
          `unknown error getting idunn poi reaching ${url} with options ${s_requestParams}`,
          err
        );
        return;
      }
    }
  }

  static getAddress(rawPoi) {
    switch (rawPoi.type) {
    case 'admin':
      return {label: rawPoi.address.admin.label};
    case 'address':
    case 'street': {
      let postcode = (rawPoi.address.postcode || '').split(';', 1)[0];
      let city = rawPoi.address.admins.find((a) => a.class_name === 'city') || {};
      let country = rawPoi.address.admins.find((a) => a.class_name === 'country') || {};
      let label = [postcode, city.name, country.name]
        .filter((x) => x).join(', ');
      return {label};
    }
    default:
      return rawPoi.address;
    }
  }

  logGradesClick(template) {
    const grades = this.blocksByType.grades;
    if (grades && grades.url) {
      Telemetry.add('reviews', 'poi', this.meta.source,
        Telemetry.buildInteractionData({
          id: this.id,
          source: this.meta.source,
          template: template,
          zone: template === 'multiple' ? 'list' : 'detail',
          element: 'reviews',
        })
      );
    }
  }

  isFromOSM() {
    return this.meta && this.meta.source === sources.osm;
  }

  isFromPagesjaunes() {
    return this.meta && this.meta.source == sources.pagesjaunes;
  }
}
