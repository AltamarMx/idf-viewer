/**
 * Site location and design conditions (D5): Site:Location, design days,
 * weather-file sizing periods, run periods, holidays and daylight saving time.
 * Values are shown as written in the IDF (or the IDD default when blank).
 */
import { type DescribedField, describeField } from './model/describe';
import type { IdfModel } from './model/model';
import { FieldReader } from './model/reader';
import type { ReferenceIndex } from './model/references';
import type { IdfObject } from './parser/idf';
import type { Schema } from './schema/types';

export interface SiteLocation {
  id: number;
  name: string;
  latitude?: number;
  longitude?: number;
  timeZone?: number;
  elevation?: number;
  fields: DescribedField[];
}

export interface DesignDayRow {
  id: number;
  name: string;
  month?: number;
  day?: number;
  dayType?: DescribedField;
  maxDryBulb?: DescribedField;
  range?: DescribedField;
  humidityType?: DescribedField;
  /** The value that goes with the humidity condition type. */
  humidity?: DescribedField;
  pressure?: DescribedField;
  windSpeed?: DescribedField;
  windDirection?: DescribedField;
  solarModel?: DescribedField;
  /** Sky clearness, taub and taud, or the solar schedules, by solar model. */
  solar: DescribedField[];
  /** All fields, for the detail. */
  fields: DescribedField[];
}

export interface PeriodRow {
  id: number;
  className: string;
  name: string;
  fields: DescribedField[];
}

export interface SpecialDayRow {
  id: number;
  name: string;
  start: string;
  duration: string;
  type: string;
}

export interface SiteView {
  location?: SiteLocation;
  designDays: DesignDayRow[];
  /** SizingPeriod:WeatherFileDays and SizingPeriod:WeatherFileConditionType. */
  weatherFilePeriods: PeriodRow[];
  runPeriods: PeriodRow[];
  specialDays: SpecialDayRow[];
  daylightSaving?: { id: number; start: string; end: string };
  /** Checks made by the viewer, not by EnergyPlus. */
  notes: { objectId?: number; text: string }[];
}

const HUMIDITY_FIELD: Record<string, RegExp> = {
  wetbulb: /^Wetbulb or DewPoint at Maximum Dry-Bulb$/,
  dewpoint: /^Wetbulb or DewPoint at Maximum Dry-Bulb$/,
  wetbulbprofiledefaultmultipliers: /^Wetbulb or DewPoint at Maximum Dry-Bulb$/,
  wetbulbprofiledifferenceschedule: /^Wetbulb or DewPoint at Maximum Dry-Bulb$/,
  wetbulbprofilemultiplierschedule: /^Wetbulb or DewPoint at Maximum Dry-Bulb$/,
  humidityratio: /^Humidity Ratio at Maximum Dry-Bulb$/,
  enthalpy: /^Enthalpy at Maximum Dry-Bulb/,
  relativehumidityschedule: /^Humidity Condition Day Schedule Name$/,
};

const SOLAR_FIELDS: Record<string, RegExp> = {
  ashraeclearsky: /^Sky Clearness$/,
  zhanghuang: /^Sky Clearness$/,
  ashraetau: /^ASHRAE Clear Sky Optical Depth for (Beam|Diffuse) Irradiance/,
  ashraetau2017: /^ASHRAE Clear Sky Optical Depth for (Beam|Diffuse) Irradiance/,
  schedule: /^(Beam|Diffuse) Solar Day Schedule Name$/,
};

export function siteView(
  model: IdfModel,
  schema: Schema | undefined,
  references: ReferenceIndex,
): SiteView {
  const view: SiteView = {
    designDays: [],
    weatherFilePeriods: [],
    runPeriods: [],
    specialDays: [],
    notes: [],
  };
  if (!schema) return view;
  const reader = (obj: IdfObject) =>
    new FieldReader(obj, schema.classes[obj.className.toLowerCase()]);
  const fieldOf = (obj: IdfObject, r: FieldReader, name: string | undefined, label?: string) =>
    describeField(obj, r, references, name, label);
  const allFields = (obj: IdfObject, r: FieldReader, skip: RegExp) =>
    (r.cls?.fields ?? [])
      .filter((f) => !skip.test(f.name))
      .map((f) => fieldOf(obj, r, f.name))
      .filter((f): f is DescribedField => Boolean(f) && (f as DescribedField).value !== '');

  const site = model.ofClass('site:location')[0];
  if (site) {
    const r = reader(site);
    view.location = {
      id: site.id,
      name: r.str('Name'),
      latitude: r.num('Latitude'),
      longitude: r.num('Longitude'),
      timeZone: r.num('Time Zone'),
      elevation: r.num('Elevation'),
      fields: allFields(site, r, /^Name$/),
    };
    const { longitude, timeZone } = view.location;
    // Each hour of time zone is 15° of longitude; a gap of more than 2 hours
    // usually means a sign mistake (west longitudes and time zones are negative).
    if (
      longitude !== undefined &&
      timeZone !== undefined &&
      Math.abs(longitude / 15 - timeZone) > 2
    ) {
      view.notes.push({
        objectId: site.id,
        text: `The time zone (UTC${timeZone >= 0 ? '+' : ''}${timeZone}) is more than 2 hours away from the longitude (${longitude}° is about UTC${longitude >= 0 ? '+' : ''}${Math.round(longitude / 15)}). Check their signs: west and south are negative.`,
      });
    }
  }

  for (const obj of model.ofClass('sizingperiod:designday')) {
    const r = reader(obj);
    const humidityType = r.strOr('Humidity Condition Type');
    const solarModel = r.strOr('Solar Model Indicator');
    const solarPattern = SOLAR_FIELDS[solarModel.toLowerCase()];
    view.designDays.push({
      id: obj.id,
      name: r.str('Name'),
      month: r.num('Month'),
      day: r.num('Day of Month'),
      dayType: fieldOf(obj, r, 'Day Type'),
      maxDryBulb: fieldOf(obj, r, 'Maximum Dry-Bulb Temperature'),
      range: fieldOf(obj, r, 'Daily Dry-Bulb Temperature Range'),
      humidityType: fieldOf(obj, r, 'Humidity Condition Type'),
      humidity: fieldOf(obj, r, r.find(HUMIDITY_FIELD[humidityType.toLowerCase()] ?? /^$/)),
      pressure: fieldOf(obj, r, 'Barometric Pressure'),
      windSpeed: fieldOf(obj, r, 'Wind Speed'),
      windDirection: fieldOf(obj, r, 'Wind Direction'),
      solarModel: fieldOf(obj, r, 'Solar Model Indicator'),
      solar: solarPattern
        ? (r.cls?.fields ?? [])
            .filter((f) => solarPattern.test(f.name))
            .map((f) => fieldOf(obj, r, f.name))
            .filter((f): f is DescribedField => Boolean(f))
        : [],
      fields: allFields(obj, r, /^Name$/),
    });
  }

  for (const key of ['sizingperiod:weatherfiledays', 'sizingperiod:weatherfileconditiontype']) {
    for (const obj of model.ofClass(key)) {
      const r = reader(obj);
      view.weatherFilePeriods.push({
        id: obj.id,
        className: obj.className,
        name: r.str('Name'),
        fields: allFields(obj, r, /^Name$/),
      });
    }
  }

  for (const obj of model.ofClass('runperiod')) {
    const r = reader(obj);
    view.runPeriods.push({
      id: obj.id,
      className: obj.className,
      name: r.str('Name'),
      fields: allFields(obj, r, /^Name$/),
    });
  }

  for (const obj of model.ofClass('runperiodcontrol:specialdays')) {
    const r = reader(obj);
    view.specialDays.push({
      id: obj.id,
      name: r.str('Name'),
      start: r.str('Start Date'),
      duration: r.strOr('Duration'),
      type: r.strOr('Special Day Type'),
    });
  }

  const dst = model.ofClass('runperiodcontrol:daylightsavingtime')[0];
  if (dst) {
    const r = reader(dst);
    view.daylightSaving = { id: dst.id, start: r.str('Start Date'), end: r.str('End Date') };
  }
  return view;
}
