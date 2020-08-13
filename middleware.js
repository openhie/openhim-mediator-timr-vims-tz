const {
  Pool
} = require('pg')
const async = require('async')
const winston = require('winston')
const moment = require('moment');

const pool = new Pool({
  user: 'postgres',
  password: '',
  database: 'timr',
  host: 'localhost',
  port: 5432,
})

module.exports = {
  getImmunizationCoverage: (periods, callback) => {
    let rows = []
    async.eachSeries(periods, (period, nxtPeriod) => {
      let startDate = moment(period.periodName, 'MMM YYYY')
        .startOf('month')
        .format('YYYY-MM-DD');
      let endDate = moment(period.periodName, 'MMM YYYY')
        .endOf('month')
        .format('YYYY-MM-DD');
      let query = `select
      ext_id as facility_id,
      mat_tbl.type_mnemonic,
      coalesce(act_list_tbl.typ_mnemonic , enc_or.typ_mnemonic, 'ActType-TimrFixedSession') as typ_mnemonic,
      sbadm_tbl.seq_id,
      pat_vw.gender_mnemonic,
      population.ext_value,
      count(case when lower(catchment.tag_value) = 'true' then 1 else null end) as in_service_area,
      count(case when lower(catchment.tag_value) <> 'true' then 1 else null end) as in_catchment
    from
      sbadm_tbl
          -- Join material
      inner join mat_tbl on (mat_tbl.mat_id = sbadm_tbl.mat_id)
          -- join facility information
      inner join fac_vw on (sbadm_tbl.fac_id = fac_vw.fac_id)
          -- fetch HIE FRID for the facility
      inner join fac_id_tbl on (fac_vw.fac_id = fac_id_tbl.fac_id and nsid = 'TZ_HFR_ID')
          -- Fetch patient information for gender
      inner join pat_vw on (pat_vw.pat_id = sbadm_tbl.pat_id)
      inner join enc_tbl using (enc_id)
      inner join act_list_act_rel_tbl on (enc_tbl.enc_id = sbadm_act_id)
      inner join act_list_tbl on (act_list_tbl.act_id = act_list_act_rel_Tbl.act_id)
          -- fetch catchment indicator extension
      left join act_tag_tbl catchment on (catchment.act_id = sbadm_tbl.act_id and catchment.tag_name = 'catchmentIndicator')
      left join (SELECT act_id, CASE WHEN tag_value = '1' THEN 'ActType-TimrOutreachSession' END AS typ_mnemonic FROM act_tag_tbl WHERE tag_name = 'outreach') enc_or ON (enc_or.act_id = sbadm_tbl.enc_id )
      left join act_ext_tbl population ON (population.act_id = sbadm_tbl.act_id and population.ext_typ = 'http://openiz.org/extensions/contrib/timr/batchPopulationType')
    where
      -- we don't want back-entered data
      sbadm_tbl.enc_id is not null
      -- we dont want supplements
      and sbadm_tbl.type_mnemonic != 'DrugTherapy'
      -- we don't want those vaccinations not done
      and not sbadm_tbl.neg_ind
      -- action occurred during month
      and sbadm_tbl.act_utc::DATE between '${startDate}' and '${endDate}'
    group by ext_id, mat_tbl.type_mnemonic, coalesce(act_list_tbl.typ_mnemonic, enc_or.typ_mnemonic, 'ActType-TimrFixedSession'), pat_vw.gender_mnemonic, sbadm_tbl.seq_id, population.ext_value`

      pool.query(query, (err, response) => {
        if (err) {
          winston.error(err)
          rows.push({
            periodName: period.periodName,
            data: []
          })
          return nxtPeriod()
        }
        if (response && response.hasOwnProperty('rows')) {
          winston.info("TImR has returned with " + response.rows.length + " rows for period " + period.periodName)
          rows.push({
            periodName: period.periodName,
            data: response.rows
          })
          return nxtPeriod()
        } else {
          winston.warn("Invalid response has been received from TImR for period " + period.periodName)
          rows.push({
            periodName: period.periodName,
            data: []
          })
          return nxtPeriod()
        }
      })
    }, () => {
      return callback(rows)
    })
  },

  getImmunizationCoverageByAge: (ages, periods, callback) => {
    let ageQuery = ''
    async.eachSeries(ages, (age, nxtAge) => {
      if (ageQuery) {
        ageQuery += 'and ' + `sbadm_tbl.act_utc - pat_vw.dob ${age.operator} '${age.age}'::INTERVAL`
      } else {
        ageQuery += `sbadm_tbl.act_utc - pat_vw.dob ${age.operator} '${age.age}'::INTERVAL`
      }
      return nxtAge()
    })
    let rows = []
    async.eachSeries(periods, (period, nxtPeriod) => {
      let startDate = moment(period.periodName, 'MMM YYYY')
        .startOf('month')
        .format('YYYY-MM-DD');
      let endDate = moment(period.periodName, 'MMM YYYY')
        .endOf('month')
        .format('YYYY-MM-DD');
      let query = `select
        ext_id as facility_id,
        mat_tbl.type_mnemonic,
        sbadm_tbl.seq_id,
        pat_vw.gender_mnemonic,
        count(case when lower(catchment.tag_value) = 'true' then 1 else null end) as in_service_area,
        count(case when lower(catchment.tag_value) <> 'true' then 1 else null end) as in_catchment
      from
        sbadm_tbl
            -- Join material
        inner join mat_tbl on (mat_tbl.mat_id = sbadm_tbl.mat_id)
            -- join facility information
        inner join fac_vw on (sbadm_tbl.fac_id = fac_vw.fac_id)
            -- fetch HIE FRID for the facility
        inner join fac_id_tbl on (fac_vw.fac_id = fac_id_tbl.fac_id and nsid = 'TZ_HFR_ID')
            -- Fetch patient information for gender
        inner join pat_vw on (pat_vw.pat_id = sbadm_tbl.pat_id)
            -- fetch catchment indicator extension
        left join act_tag_tbl catchment on (catchment.act_id = sbadm_tbl.act_id and catchment.tag_name = 'catchmentIndicator')
      where
        -- we don't want back-entered data
        sbadm_tbl.enc_id is not null
        -- we dont want supplements
        and sbadm_tbl.type_mnemonic != 'DrugTherapy'
        -- we don't want those vaccinations not done
        and not sbadm_tbl.neg_ind
        -- action occurred during month
        and sbadm_tbl.act_utc::DATE between '${startDate}' and '${endDate}'
        and ${ageQuery}
      group by ext_id, mat_tbl.type_mnemonic, pat_vw.gender_mnemonic, sbadm_tbl.seq_id`
      pool.query(query, (err, response) => {
        if (err) {
          winston.error(err)
          rows.push({
            periodName: period.periodName,
            data: []
          })
          return nxtPeriod()
        }
        if (response && response.hasOwnProperty('rows')) {
          winston.info("TImR has returned with " + response.rows.length + " rows for period " + period.periodName)
          rows.push({
            periodName: period.periodName,
            data: response.rows
          })
          return nxtPeriod()
        } else {
          winston.warn("Invalid response has been received from TImR for period " + period.periodName)
          rows.push({
            periodName: period.periodName,
            data: []
          })
          return nxtPeriod()
        }
      })
    }, () => {
      return callback(rows)
    })
  },

  getCTCReferal: (periods, callback) => {
    //add pat_vw.dob - pat_vw.crt_utc < '12 MONTH'::INTERVAL to filter by age
    let rows = []
    async.eachSeries(periods, (period, nxtPeriod) => {
      let startDate = moment(period.periodName, 'MMM YYYY')
        .startOf('month')
        .format('YYYY-MM-DD');
      let endDate = moment(period.periodName, 'MMM YYYY')
        .endOf('month')
        .format('YYYY-MM-DD');
      let query = `select
        ext_id as facility_id,
        pat_vw.gender_mnemonic,
        ebf.ext_value,
        count(*) as total
      from
        pat_vw
        inner join ent_ext_tbl as ebf on (pat_vw.pat_id = ebf.ent_id and ebf.ext_typ = 'http://openiz.org/extensions/contrib/timr/ctcReferral')
        inner join fac_id_tbl on (fac_id_tbl.fac_id = pat_vw.fac_id and nsid = 'TZ_HFR_ID')
      where
      crt_utc::DATE between '${startDate}' and '${endDate}'
      group by
        ext_id, ebf.ext_value, pat_vw.gender_mnemonic order by ext_id`

      pool.query(query, (err, response) => {
        if (err) {
          winston.error(err)
          rows.push({
            periodName: period.periodName,
            data: []
          })
          return nxtPeriod()
        }
        if (response && response.hasOwnProperty('rows')) {
          winston.info("TImR has returned with " + response.rows.length + " rows for period " + period.periodName)
          rows.push({
            periodName: period.periodName,
            data: response.rows
          })
          return nxtPeriod()
        } else {
          winston.warn("Invalid response has been received from TImR for period " + period.periodName)
          rows.push({
            periodName: period.periodName,
            data: []
          })
          return nxtPeriod()
        }
      })
    }, () => {
      return callback(rows)
    })
  },

  getDiseaseData: (periods, callback) => {
    let rows = []
    async.eachSeries(periods, (period, nxtPeriod) => {
      let startDate = moment(period.periodName, 'MMM YYYY')
        .startOf('month')
        .format('YYYY-MM-DD');
      let endDate = moment(period.periodName, 'MMM YYYY')
        .endOf('month')
        .format('YYYY-MM-DD');
      let query = `select
      ext_id as facility_id,
      prob_mnemonic,
      typ_mnemonic,
      count(*) as total
    from
      cond_tbl
      inner join pat_vw using (pat_id)
      inner join fac_vw on (cond_tbl.fac_id = fac_vw.fac_id)
      inner join fac_id_tbl on (fac_id_tbl.fac_id = fac_vw.fac_id and nsid = 'TZ_HFR_ID')
    where
      act_utc::DATE between '${startDate}' and '${endDate}'
    group by ext_id, prob_mnemonic, typ_mnemonic`
      pool.query(query, (err, response) => {
        if (err) {
          winston.error(err)
          rows.push({
            periodName: period.periodName,
            data: []
          })
          return nxtPeriod()
        }
        if (response && response.hasOwnProperty('rows')) {
          winston.info("TImR has returned with " + response.rows.length + " rows for period " + period.periodName)
          rows.push({
            periodName: period.periodName,
            data: response.rows
          })
          return nxtPeriod()
        } else {
          winston.warn("Invalid response has been received from TImR for period " + period.periodName)
          rows.push({
            periodName: period.periodName,
            data: []
          })
          return nxtPeriod()
        }
      })
    }, () => {
      return callback(rows)
    })
  },

  getWeightAgeRatio: (ages, periods, callback) => {
    let ageQuery = ''
    async.eachSeries(ages, (age, nxtAge) => {
      if (ageQuery) {
        ageQuery += ' and ' + `act_utc - dob ${age.operator} '${age.age}'::INTERVAL`
      } else {
        ageQuery += `act_utc - dob ${age.operator} '${age.age}'::INTERVAL`
      }
      return nxtAge()
    })
    let rows = []
    async.eachSeries(periods, (period, nxtPeriod) => {
      let startDate = moment(period.periodName, 'MMM YYYY')
        .startOf('month')
        .format('YYYY-MM-DD');
      let endDate = moment(period.periodName, 'MMM YYYY')
        .endOf('month')
        .format('YYYY-MM-DD');
      let query = `select
        ext_id as facility_id,
        gender_mnemonic,
        int_cs as code,
        count(*) as total
      from
        qty_obs_tbl
        inner join pat_vw using (pat_id)
        inner join fac_vw on (qty_obs_tbl.fac_id = fac_vw.fac_id)
        inner join fac_id_tbl on (fac_id_tbl.fac_id = fac_vw.fac_id and nsid = 'TZ_HFR_ID')
      where
        typ_cs = 'VitalSign-Weight'
        and act_utc::DATE between '${startDate}' and '${endDate}'
        and ${ageQuery}
      group by ext_id, gender_mnemonic, int_cs`

      pool.query(query, (err, response) => {
        if (err) {
          winston.error(err)
          rows.push({
            periodName: period.periodName,
            data: []
          })
          return nxtPeriod()
        }
        if (response && response.hasOwnProperty('rows')) {
          winston.info("TImR has returned with " + response.rows.length + " rows for period " + period.periodName)
          rows.push({
            periodName: period.periodName,
            data: response.rows
          })
          return nxtPeriod()
        } else {
          winston.warn("Invalid response has been received from TImR for period " + period.periodName)
          rows.push({
            periodName: period.periodName,
            data: []
          })
          return nxtPeriod()
        }
      })
    }, () => {
      return callback(rows)
    })
  },

  getChildVisitData: (ages, periods, callback) => {
    let ageQuery = ''
    async.eachSeries(ages, (age, nxtAge) => {
      if (ageQuery) {
        ageQuery += ' and ' + `act_utc - dob ${age.operator} '${age.age}'::INTERVAL`
      } else {
        ageQuery += `act_utc - dob ${age.operator} '${age.age}'::INTERVAL`
      }
      return nxtAge()
    })
    let rows = []
    async.eachSeries(periods, (period, nxtPeriod) => {
      let startDate = moment(period.periodName, 'MMM YYYY')
        .startOf('month')
        .format('YYYY-MM-DD');
      let endDate = moment(period.periodName, 'MMM YYYY')
        .endOf('month')
        .format('YYYY-MM-DD');
      let query = `select
          ext_id as facility_id,
          gender_mnemonic,
          count(*) as total
      from
          enc_tbl
          inner join pat_vw using (pat_id)
          inner join fac_vw on (enc_tbl.fac_id = fac_vw.fac_id)
          inner join fac_id_tbl on (fac_id_tbl.fac_id = fac_vw.fac_id and nsid = 'TZ_HFR_ID')
      where
          act_utc::DATE between '${startDate}' and '${endDate}'
          and ${ageQuery}
          and pat_vw.sts_cs = 'ACTIVE'
      group by ext_id, gender_mnemonic`

      pool.query(query, (err, response) => {
        if (err) {
          winston.error(err)
          rows.push({
            periodName: period.periodName,
            data: []
          })
          return nxtPeriod()
        }
        if (response && response.hasOwnProperty('rows')) {
          winston.info("TImR has returned with " + response.rows.length + " rows for period " + period.periodName)
          rows.push({
            periodName: period.periodName,
            data: response.rows
          })
          return nxtPeriod()
        } else {
          winston.warn("Invalid response has been received from TImR for period " + period.periodName)
          rows.push({
            periodName: period.periodName,
            data: []
          })
          return nxtPeriod()
        }
      })
    }, () => {
      return callback(rows)
    })
  },

  getSupplementsData: (ages, periods, callback) => {
    let ageQuery = ''
    async.eachSeries(ages, (age, nxtAge) => {
      if (ageQuery) {
        ageQuery += ' and ' + `act_utc - dob ${age.operator} '${age.age}'::INTERVAL`
      } else {
        ageQuery += `act_utc - dob ${age.operator} '${age.age}'::INTERVAL`
      }
      return nxtAge()
    })
    let rows = []
    async.eachSeries(periods, (period, nxtPeriod) => {
      let startDate = moment(period.periodName, 'MMM YYYY')
        .startOf('month')
        .format('YYYY-MM-DD');
      let endDate = moment(period.periodName, 'MMM YYYY')
        .endOf('month')
        .format('YYYY-MM-DD');
      let query = `select
          ext_id as facility_id,
          mat_tbl.type_mnemonic as code,
          gender_mnemonic,
          count(*) as total
      from
          sbadm_tbl
          inner join mat_tbl using (mat_id)
          inner join pat_vw using (pat_id)
          inner join fac_vw on (sbadm_tbl.fac_id = fac_vw.fac_id)
          inner join fac_id_tbl on (fac_id_tbl.fac_id = fac_vw.fac_id and nsid = 'TZ_HFR_ID')
      where
          act_utc::DATE between '${startDate}' and '${endDate}'
          and ${ageQuery}
          and sbadm_tbl.type_mnemonic = 'DrugTherapy'
      group by ext_id, mat_tbl.type_mnemonic, gender_mnemonic`

      pool.query(query, (err, response) => {
        if (err) {
          winston.error(err)
          rows.push({
            periodName: period.periodName,
            data: []
          })
          return nxtPeriod()
        }
        if (response && response.hasOwnProperty('rows')) {
          winston.info("TImR has returned with " + response.rows.length + " rows for period " + period.periodName)
          rows.push({
            periodName: period.periodName,
            data: response.rows
          })
          return nxtPeriod()
        } else {
          winston.warn("Invalid response has been received from TImR for period " + period.periodName)
          rows.push({
            periodName: period.periodName,
            data: []
          })
          return nxtPeriod()
        }
      })
    }, () => {
      return callback(rows)
    })
  },

  getAEFIData: (periods, callback) => {
    let rows = []
    async.eachSeries(periods, (period, nxtPeriod) => {
      let startDate = moment(period.periodName, 'MMM YYYY')
        .startOf('month')
        .format('YYYY-MM-DD');
      let endDate = moment(period.periodName, 'MMM YYYY')
        .endOf('month')
        .format('YYYY-MM-DD');
      let query = `select
      ext_id as facility_id,
      start as start_date,
      mat_tbl.type_mnemonic,
      count(*) as total
    from
      aefi_tbl
      inner join mat_tbl using (mat_id)
      inner join pat_vw using (pat_id)
      inner join fac_vw on (aefi_tbl.fac_id = fac_vw.fac_id)
      inner join fac_id_tbl on (fac_id_tbl.fac_id = fac_vw.fac_id and nsid = 'TZ_HFR_ID')
    where
      aefi_tbl.crt_utc between '${startDate}' and '${endDate}'
    group by ext_id, mat_tbl.type_mnemonic,start`

      pool.query(query, (err, response) => {
        if (err) {
          winston.error(err)
          rows.push({
            periodName: period.periodName,
            data: []
          })
          return nxtPeriod()
        }
        if (response && response.hasOwnProperty('rows')) {
          winston.info("TImR has returned with " + response.rows.length + " rows for period " + period.periodName)
          rows.push({
            periodName: period.periodName,
            data: response.rows
          })
          return nxtPeriod()
        } else {
          winston.warn("Invalid response has been received from TImR for period " + period.periodName)
          rows.push({
            periodName: period.periodName,
            data: []
          })
          return nxtPeriod()
        }
      })
    }, () => {
      return callback(rows)
    })
  },

  getColdChainData: (periods, callback) => {
    let rows = []
    async.eachSeries(periods, (period, nxtPeriod) => {
      let year_month = moment(period.periodName, 'MMM YYYY')
        .startOf('month')
        .format('YYYY-MM');
      let query = `select
        ext_id as facility_id,
        encode(decode(substr(ext_value, 3), 'hex'), 'escape')::JSON->'${year_month}'->'coldStoreMin' as coldStoreMinTemp,
        encode(decode(substr(ext_value, 3), 'hex'), 'escape')::JSON->'${year_month}'->'coldStoreMax' as coldStoreMaxTemp,
        encode(decode(substr(ext_value, 3), 'hex'), 'escape')::JSON->'${year_month}'->'coldStoreLow' as coldStoreLowTempAlert,
        encode(decode(substr(ext_value, 3), 'hex'), 'escape')::JSON->'${year_month}'->'coldStoreHigh' as coldStoreHighTempAlert,
        encode(decode(substr(ext_value, 3), 'hex'), 'escape')::JSON->'${year_month}'->'outreachPlan' as outreachPlanned,
        encode(decode(substr(ext_value, 3), 'hex'), 'escape')::JSON->'${year_month}'->'outreach' as outreachPerformed,
        encode(decode(substr(ext_value, 3), 'hex'), 'escape')::JSON->'${year_month}'->'outreachCancel' as outreachCancelled,
        encode(decode(substr(ext_value, 3), 'hex'), 'escape')::JSON->'${year_month}'->'sessions' as sessions,
        encode(decode(substr(ext_value, 3), 'hex'), 'escape')::JSON->'${year_month}'->'status' as status
    from
        fac_vw
        inner join ent_ext_tbl on (fac_vw.fac_id = ent_ext_tbl.ent_id and ext_typ = 'http://openiz.org/extensions/contrib/bid/ivdExtendedData')
        inner join fac_id_tbl on (fac_id_tbl.fac_id = fac_vw.fac_id and nsid = 'TZ_HFR_ID')`
      pool.query(query, (err, response) => {
        if (err) {
          winston.error(err)
          rows.push({
            periodName: period.periodName,
            data: []
          })
          return nxtPeriod()
        }
        if (response && response.hasOwnProperty('rows')) {
          winston.info("TImR has returned with " + response.rows.length + " rows for period " + period.periodName)
          rows.push({
            periodName: period.periodName,
            data: response.rows
          })
          return nxtPeriod()
        } else {
          winston.warn("Invalid response has been received from TImR for period " + period.periodName)
          rows.push({
            periodName: period.periodName,
            data: []
          })
          return nxtPeriod()
        }
      })
    }, () => {
      return callback(rows)
    })
  },

  getBreastFeedingData: (ages, periods, callback) => {
    let ageQuery = ''
    async.eachSeries(ages, (age, nxtAge) => {
      if (ageQuery) {
        ageQuery += 'and ' + `pat_vw.dob - pat_vw.crt_utc ${age.operator} '${age.age}'::INTERVAL`
      } else {
        ageQuery += `pat_vw.dob - pat_vw.crt_utc ${age.operator} '${age.age}'::INTERVAL`
      }
      return nxtAge()
    })
    let rows = []
    async.eachSeries(periods, (period, nxtPeriod) => {
      let startDate = moment(period.periodName, 'MMM YYYY')
        .startOf('month')
        .format('YYYY-MM-DD');
      let endDate = moment(period.periodName, 'MMM YYYY')
        .endOf('month')
        .format('YYYY-MM-DD');
      let query = `select
        ext_id as facility_id,
        pat_vw.gender_mnemonic,
        ebf.ext_value,
        count(*) as total
      from
        pat_vw
        inner join ent_ext_tbl as ebf on (pat_vw.pat_id = ebf.ent_id and ebf.ext_typ = 'http://openiz.org/extensions/patient/contrib/timr/breastFeedingStatus')
        inner join fac_id_tbl on (fac_id_tbl.fac_id = pat_vw.fac_id and nsid = 'TZ_HFR_ID')
      where
      ${ageQuery} and crt_utc::DATE between '${startDate}' and '${endDate}' and (ext_value='1' or ext_value='2')
      group by
        ext_id, ebf.ext_value, pat_vw.gender_mnemonic order by ext_id`

      pool.query(query, (err, response) => {
        if (err) {
          winston.error(err)
          rows.push({
            periodName: period.periodName,
            data: []
          })
          return nxtPeriod()
        }
        if (response && response.hasOwnProperty('rows')) {
          winston.info("TImR has returned with " + response.rows.length + " rows for period " + period.periodName)
          rows.push({
            periodName: period.periodName,
            data: response.rows
          })
          return nxtPeriod()
        } else {
          winston.warn("Invalid response has been received from TImR for period " + period.periodName)
          rows.push({
            periodName: period.periodName,
            data: []
          })
          return nxtPeriod()
        }
      })
    }, () => {
      return callback(rows)
    })
  },

  getPMTCTData: (periods, callback) => {
    let rows = []
    async.eachSeries(periods, (period, nxtPeriod) => {
      let startDate = moment(period.periodName, 'MMM YYYY')
        .startOf('month')
        .format('YYYY-MM-DD');
      let endDate = moment(period.periodName, 'MMM YYYY')
        .endOf('month')
        .format('YYYY-MM-DD');
      let query = `select
        ext_id as facility_id,
        pat_vw.gender_mnemonic,
        ebf.ext_value,
        count(*) as total
      from
        pat_vw
        inner join ent_ext_tbl as ebf on (pat_vw.pat_id = ebf.ent_id and ebf.ext_typ = 'http://openiz.org/extensions/patient/contrib/timr/pctmtStatus')
        inner join fac_id_tbl on (fac_id_tbl.fac_id = pat_vw.fac_id and nsid = 'TZ_HFR_ID')
      where
        crt_utc::DATE between '${startDate}' and '${endDate}' and ext_value='1'
      group by
        ext_id, ebf.ext_value, pat_vw.gender_mnemonic order by ext_id`

      pool.query(query, (err, response) => {
        if (err) {
          winston.error(err)
          rows.push({
            periodName: period.periodName,
            data: []
          })
          return nxtPeriod()
        }
        if (response && response.hasOwnProperty('rows')) {
          winston.info("TImR has returned with " + response.rows.length + " rows for period " + period.periodName)
          rows.push({
            periodName: period.periodName,
            data: response.rows
          })
          return nxtPeriod()
        } else {
          winston.warn("Invalid response has been received from TImR for period " + period.periodName)
          rows.push({
            periodName: period.periodName,
            data: []
          })
          return nxtPeriod()
        }
      })
    }, () => {
      return callback(rows)
    })
  },

  getTTData: (periods, callback) => {
    let rows = []
    async.eachSeries(periods, (period, nxtPeriod) => {
      let startDate = moment(period.periodName, 'MMM YYYY')
        .startOf('month')
        .format('YYYY-MM-DD');
      let endDate = moment(period.periodName, 'MMM YYYY')
        .endOf('month')
        .format('YYYY-MM-DD');
      let query = `select
        ext_id as facility_id,
        pat_tbl.gender_mnemonic,
        ebf.ext_value,
        count(*) as total
      from
        pat_tbl
        inner join psn_tbl using (psn_id)
        inner join ent_ext_tbl as ebf on (pat_tbl.pat_id = ebf.ent_id and ebf.ext_typ = 'http://openiz.org/extensions/patient/contrib/timr/tetanusStatus')
        inner join fac_id_tbl on (fac_id_tbl.fac_id = pat_tbl.reg_fac_id and nsid = 'TZ_HFR_ID')
      where
        crt_utc::DATE between '${startDate}' and '${endDate}' and (ext_value='0' or ext_value='1' or ext_value='2')
      group by
        ext_id, ebf.ext_value, pat_tbl.gender_mnemonic order by ext_id`
      pool.query(query, (err, response) => {
        if (err) {
          winston.error(err)
          rows.push({
            periodName: period.periodName,
            data: []
          })
          return nxtPeriod()
        }
        if (response && response.hasOwnProperty('rows')) {
          winston.info("TImR has returned with " + response.rows.length + " rows for period " + period.periodName)
          rows.push({
            periodName: period.periodName,
            data: response.rows
          })
          return nxtPeriod()
        } else {
          winston.warn("Invalid response has been received from TImR for period " + period.periodName)
          rows.push({
            periodName: period.periodName,
            data: []
          })
          return nxtPeriod()
        }
      })
    }, () => {
      return callback(rows)
    })
  },

  getChildrUsingMosqNetAtRegData: (periods, callback) => {
    let rows = []
    async.eachSeries(periods, (period, nxtPeriod) => {
      let startDate = moment(period.periodName, 'MMM YYYY')
        .startOf('month')
        .format('YYYY-MM-DD');
      let endDate = moment(period.periodName, 'MMM YYYY')
        .endOf('month')
        .format('YYYY-MM-DD');
      let query = `select
        ext_id as facility_id,
        pat_vw.gender_mnemonic,
        ebf.ext_value,
        count(*) as total
      from
        pat_vw
        inner join ent_ext_tbl as ebf on (pat_vw.pat_id = ebf.ent_id and ebf.ext_typ = 'http://openiz.org/extensions/patient/contrib/timr/mosquitoNetStatus')
        inner join fac_id_tbl on (fac_id_tbl.fac_id = pat_vw.fac_id and nsid = 'TZ_HFR_ID')
      where
        crt_utc::DATE between '${startDate}' and '${endDate}'
      group by
        ext_id, ebf.ext_value, pat_vw.gender_mnemonic order by ext_id`

      pool.query(query, (err, response) => {
        if (err) {
          winston.error(err)
          rows.push({
            periodName: period.periodName,
            data: []
          })
          return nxtPeriod()
        }
        if (response && response.hasOwnProperty('rows')) {
          winston.info("TImR has returned with " + response.rows.length + " rows for period " + period.periodName)
          rows.push({
            periodName: period.periodName,
            data: response.rows
          })
          return nxtPeriod()
        } else {
          winston.warn("Invalid response has been received from TImR for period " + period.periodName)
          rows.push({
            periodName: period.periodName,
            data: []
          })
          return nxtPeriod()
        }
      })
    }, () => {
      return callback(rows)
    })
  },

  getDispLLINMosqNet: (periods, callback) => {
    let rows = []
    async.eachSeries(periods, (period, nxtPeriod) => {
      let startDate = moment(period.periodName, 'MMM YYYY')
        .startOf('month')
        .format('YYYY-MM-DD');
      let endDate = moment(period.periodName, 'MMM YYYY')
        .endOf('month')
        .format('YYYY-MM-DD');
      let query = `select
        ext_id as facility_id,
        gender_mnemonic,
        count(*) as total
        from
            sply_tbl
            -- ensure that the material given was a mosquito net
            left join sply_mat_tbl on (sply_tbl.sply_id = sply_mat_tbl.sply_id and sply_mat_tbl.mat_id = '276d2ce0-6504-11e9-a923-1681be663d3e')
            -- in a supply the source entity is the facility
            inner join fac_vw on (src_ent_id = fac_id)
            -- fetch HIE FRID for the facility
            inner join fac_id_tbl on (fac_vw.fac_id = fac_id_tbl.fac_id and nsid = 'TZ_HFR_ID')
            -- in a supply the target entity is the patient (i.e. the facility is supplying to the patient)
            inner join enc_tbl using (enc_id)
            inner join pat_Vw on (enc_tbl.pat_id = pat_vw.pat_id)
        where
            typ_mnemonic = 'ActType-SupplyToPatient'
            and sply_tbl.act_utc::DATE between '${startDate}' and '${endDate}'
        group by ext_id, gender_mnemonic`

      pool.query(query, (err, response) => {
        if (err) {
          winston.error(err)
          rows.push({
            periodName: period.periodName,
            data: []
          })
          return nxtPeriod()
        }
        if (response && response.hasOwnProperty('rows')) {
          winston.info("TImR has returned with " + response.rows.length + " rows for period " + period.periodName)
          rows.push({
            periodName: period.periodName,
            data: response.rows
          })
          return nxtPeriod()
        } else {
          winston.warn("Invalid response has been received from TImR for period " + period.periodName)
          rows.push({
            periodName: period.periodName,
            data: []
          })
          return nxtPeriod()
        }
      })
    }, () => {
      return callback(rows)
    })
  },

  getStockONHAND: (periods, callback) => {
    let rows = []
    async.eachSeries(periods, (period, nxtPeriod) => {
      var firstDateNewMonth = moment(period.periodName, 'MMM YYYY')
        .startOf('month')
        .add(1, 'month')
        .format('YYYY-MM-DD');
      let query = `WITH ordered_ledger AS (
            SELECT fac_id, mmat_id, bal_eol
            FROM
                fac_mat_ldgr_tbl
            WHERE
                crt_utc < '${firstDateNewMonth}'
            ORDER BY seq_id DESC
        ), distinct_stock AS (
            SELECT DISTINCT fac_id, mmat_id
            FROM
                fac_mat_ldgr_tbl
        ), by_mmat AS (
            SELECT ext_id as facility_id, mmat_id, COALESCE(FIRST(bal_eol), 0) AS balance_eom
            FROM
                distinct_stock
                LEFT JOIN ordered_ledger USING (fac_id, mmat_id)
                INNER JOIN fac_id_tbl ON (distinct_stock.fac_id = fac_id_tbl.fac_id AND nsid = 'TZ_HFR_ID')
            GROUP BY ext_id, mmat_id
        )
        SELECT facility_id, type_mnemonic, SUM(balance_eom) as balance_eom
        FROM by_mmat
            INNER JOIN mmat_tbl USING (mmat_id)
        GROUP BY facility_id, type_mnemonic`

      pool.query(query, (err, response) => {
        if (err) {
          winston.error(err)
          rows.push({
            periodName: period.periodName,
            data: []
          })
          return nxtPeriod()
        }
        if (response && response.hasOwnProperty('rows')) {
          winston.info("TImR has returned with " + response.rows.length + " rows for period " + period.periodName)
          rows.push({
            periodName: period.periodName,
            data: response.rows
          })
          return nxtPeriod()
        } else {
          winston.warn("Invalid response has been received from TImR for period " + period.periodName)
          rows.push({
            periodName: period.periodName,
            data: []
          })
          return nxtPeriod()
        }
      })
    }, () => {
      return callback(rows)
    })
  },

  getStockAdjustments: (periods, callback) => {
    let rows = []
    async.eachSeries(periods, (period, nxtPeriod) => {
      let startDate = moment(period.periodName, 'MMM YYYY')
        .startOf('month')
        .format('YYYY-MM-DD');
      let endDate = moment(period.periodName, 'MMM YYYY')
        .endOf('month')
        .format('YYYY-MM-DD');
      let query = `SELECT ext_id as facility_id, ct.*
    FROM
      crosstab($$
        SELECT
          fac_id::text || type_mnemonic::text as k,
          fac_id,
          type_mnemonic,
          rsn_desc,
          sum(abs(qty))
        FROM
          fac_mat_ldgr_tbl
          INNER JOIN mmat_tbl USING (mmat_id)
        WHERE
          rsn_desc in ('REASON-ColdStorageFailure','REASON-Wasted','REASON-Expired', 'REASON-VVM', 'REASON-Broken', 'REASON-FROZEN', 'REASON-OPENWASTE')
          AND fac_mat_ldgr_tbl.crt_utc::DATE BETWEEN '${startDate}' AND '${endDate}'
        GROUP BY fac_id, type_mnemonic, rsn_desc
        ORDER BY 1, 2, 3
        $$, $$VALUES ('REASON-Broken'), ('REASON-ColdStorageFailure'), ('REASON-Expired'), ('REASON-FROZEN'), ('REASON-OPENWASTE'), ('REASON-VVM'),('REASON-Wasted') $$) ct (
          key text,
          fac_id uuid,
          type_mnemonic text,
          "REASON-Broken" INT,
          "REASON-ColdStorageFailure" INT,
          "REASON-Expired" INT,
          "REASON-FROZEN" INT,
          "REASON-OPENWASTE" INT,
          "REASON-VVM" INT,
          "REASON-Wasted" INT
      )
      INNER JOIN fac_id_tbl ON (fac_id_tbl.fac_id = ct.fac_id AND nsid = 'TZ_HFR_ID')`

      pool.query(query, (err, response) => {
        if (err) {
          winston.error(err)
          rows.push({
            periodName: period.periodName,
            data: []
          })
          return nxtPeriod()
        }
        if (response && response.hasOwnProperty('rows')) {
          winston.info("TImR has returned with " + response.rows.length + " rows for period " + period.periodName)
          rows.push({
            periodName: period.periodName,
            data: response.rows
          })
          return nxtPeriod()
        } else {
          winston.warn("Invalid response has been received from TImR for period " + period.periodName)
          rows.push({
            periodName: period.periodName,
            data: []
          })
          return nxtPeriod()
        }
      })
    }, () => {
      return callback(rows)
    })
  },

  getDefaulters(defDays, schedualeDate, callback) {
    let query = `SELECT
      location_id,
      patient_id,
      MAX(act_date) AS act_date,
      MAX(-(act_date + '${defDays} day'::INTERVAL - CURRENT_DATE)) AS days_overdue,
      string_agg(DISTINCT replace(mat_tbl.type_mnemonic, 'VaccineType-',''), ',') as missed_doses,
      FIRST(gender_mnemonic) as gender_mnemonic,
      FIRST(dob) as DOB,
      first(family)
  as family,
      first(given) as given,
      first(tel) as tel,
      first(mth_family) as mth_family,
      first(mth_given) as mth_given,
      first(mth_tel) as mth_tel,
      first(nok_family) as nok_family,
      first(nok_given) as nok_given,
      first(nok_tel) as nok_tel
    FROM
      oizcp
      INNER JOIN pat_vw ON (patient_id = pat_id)
      INNER JOIN mat_tbl ON (mat_id = product_id)
    WHERE
      act_date = '${schedualeDate}'
      AND (fulfilled IS NULL OR fulfilled = FALSE)
      AND NOT EXISTS (
        SELECT 1
        FROM
          sbadm_tbl
        WHERE
          mat_id = product_id AND
          pat_id = patient_id AND
          seq_id = dose_seq AND
          (neg_ind IS NULL OR neg_ind = FALSE)
          AND enc_id IS NOT NULL

      )
    GROUP BY location_id, patient_id`
    pool.query(query, (err, response) => {
      if (err) {
        winston.error(err)
        return callback(err, [])
      }
      if (response && response.hasOwnProperty('rows')) {
        winston.info("TImR has returned with " + response.rows.length + " list of defaulters")
        return callback(false, response.rows)
      } else {
        winston.warn("Invalid response has been received from TImR while getting defaulters list " + response)
        return callback(err, [])
      }
    })
  },

  getMsgs(callback) {
    winston.info("Getting message queue from timr")
    let query = `select msg_id, to_addr, body_txt, sent_utc from msg_queue_tbl where sent_utc is NULL`
    pool.query(query, (err, response) => {
      if (err) {
        winston.error(err)
        return callback(err, [])
      }
      if (response && response.hasOwnProperty('rows')) {
        winston.info("TImR has returned with " + response.rows.length + " messages")
        return callback(false, response.rows)
      } else {
        winston.warn("Invalid response has been received from TImR while getting message queue " + response)
        return callback(err, [])
      }
    })
  },

  markMsgSent(msg_id) {
    winston.info("Marking message as being sent")
    let sent = moment().format("YYYY-MM-DD hh:mm:ss.SSSZ")
    let query = `update msg_queue_tbl set sent_utc='${sent}' where msg_id='${msg_id}'`
    pool.query(query, (err, response) => {
      if (err) {
        winston.error('An error occured while marking timr message as sent')
        winston.error(err)
        return
      }
      winston.info("Done marking message as sent")
    })
  }
}