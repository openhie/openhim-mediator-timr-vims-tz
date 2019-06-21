const { Pool } = require('pg')
const async = require('async')
const winston = require('winston')

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'timrdwh_latest',
  password: 'tajiri',
  port: 5432,
})

module.exports = {
  getImmunizationCoverage: (startDate, endDate, callback) => {
    let query = `select
      ext_id as facility_id,
      mat_tbl.type_mnemonic,
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
          -- fetch catchment indicator extension
      left join act_tag_tbl catchment on (catchment.act_id = sbadm_tbl.act_id and catchment.tag_name = 'catchmentIndicator')
      left join act_ext_tbl population ON (population.act_id = sbadm_tbl.act_id and population.ext_typ = 'http://openiz.org/extensions/contrib/timr/batchPopulationType')
    where
      -- we don't want back-entered data
      sbadm_tbl.act_id not in (select act_id from act_tag_tbl where tag_name = 'backEntry' and lower(tag_value) = 'true')
      -- we dont want supplements
      and sbadm_tbl.type_mnemonic != 'DrugTherapy'
      -- we don't want those vaccinations not done
      and not sbadm_tbl.neg_ind
      -- action occurred during month
      and sbadm_tbl.act_utc::DATE between '${startDate}' and '${endDate}'
    group by ext_id, mat_tbl.type_mnemonic, pat_vw.gender_mnemonic, sbadm_tbl.seq_id, population.ext_value`

      pool.query(query, (err, response) => {
        if(err) {
          winston.error(err)
          return callback([])
        }
        if(response && response.hasOwnProperty('rows')) {
          return callback(response.rows)
        } else {
          return callback([])
        }
      })
  },

  getImmunizationCoverageByAge: (ages, startDate, endDate, callback) => {
    let ageQuery = ''
    if(ages.length = 2) {
      let age1 = ages[0]
      let age2 = ages[1]
      if(age1<age2) {
        ageQuery = `sbadm_tbl.act_utc - pat_vw.dob BETWEEN '${age1.age}'::INTERVAL AND '${age2.age}'::INTERVAL`
      } else {
        ageQuery = `sbadm_tbl.act_utc - pat_vw.dob BETWEEN '${age2.age}'::INTERVAL AND '${age1.age}'::INTERVAL`
      }
    } else {
      async.eachSeries(ages, (age, nxtAge) => {
        if(ageQuery) {
          ageQuery += 'and ' + `sbadm_tbl.act_utc - pat_vw.dob ${age.operator} '${age.age}'::INTERVAL`
        } else {
          ageQuery += `sbadm_tbl.act_utc - pat_vw.dob ${age.operator} '${age.age}'::INTERVAL`
        }
        return nxtAge()
      })
    }
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
      sbadm_tbl.act_id not in (select act_id from act_tag_tbl where tag_name = 'backEntry' and lower(tag_value) = 'true')
      -- we dont want supplements
      and sbadm_tbl.type_mnemonic != 'DrugTherapy'
      -- we don't want those vaccinations not done
      and not sbadm_tbl.neg_ind
      -- action occurred during month
      and sbadm_tbl.act_utc::DATE between '${startDate}' and '${endDate}'
      and ${ageQuery}
    group by ext_id, mat_tbl.type_mnemonic, pat_vw.gender_mnemonic, sbadm_tbl.seq_id`
    pool.query(query, (err, response) => {
      if(err) {
        winston.error(err)
        return callback([])
      }
      if(response && response.hasOwnProperty('rows')) {
        return callback(response.rows)
      } else {
        return callback([])
      }
    })
  },

  getCTCReferal: (startDate, endDate, callback) => {
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
    pat_vw.dob - pat_vw.crt_utc < '12 MONTH'::INTERVAL and crt_utc::DATE between '2018-01-01' and '2019-06-30'
    group by
      ext_id, ebf.ext_value, pat_vw.gender_mnemonic order by ext_id;`
  },

  getDiseaseData: (startDate, endDate, callback) => {
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
      if(err) {
        winston.error(err)
        return callback([])
      }
      if(response && response.hasOwnProperty('rows')) {
        return callback(response.rows)
      } else {
        return callback([])
      }
    })
  },

  getWeightAgeRatio: (ages, startDate, endDate, callback) => {
    let ageQuery = ''
    async.eachSeries(ages, (age, nxtAge) => {
      if(ageQuery) {
        ageQuery += ' and ' + `act_utc - dob ${age.operator} '${age.age}'::INTERVAL`
      } else {
        ageQuery += `act_utc - dob ${age.operator} '${age.age}'::INTERVAL`
      }
      return nxtAge()
    })
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
      if(err) {
        winston.error(err)
        return callback([])
      }
      if(response && response.hasOwnProperty('rows')) {
        return callback(response.rows)
      } else {
        return callback([])
      }
    })
  },

  getChildVisitData: (ages, startDate, endDate, callback) => {
    let ageQuery = ''
    async.eachSeries(ages, (age, nxtAge) => {
      if(ageQuery) {
        ageQuery += ' and ' + `act_utc - dob ${age.operator} '${age.age}'::INTERVAL`
      } else {
        ageQuery += `act_utc - dob ${age.operator} '${age.age}'::INTERVAL`
      }
      return nxtAge()
    })
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
      if(err) {
        winston.error(err)
        return callback([])
      }
      if(response && response.hasOwnProperty('rows')) {
        return callback(response.rows)
      } else {
        return callback([])
      }
    })
  },

  getSupplementsData: (ages, startDate, endDate, callback) => {
    let ageQuery = ''
    if(ages.length == 2) {
      let age1 = ages[0]
      let age2 = ages[1]
      let ageNumber1 = parseFloat(age1.age.split(' ').shift())
      let ageNumber2 = parseFloat(age2.age.split(' ').shift())
      if(ageNumber1<ageNumber2) {
        ageQuery = `act_utc - dob BETWEEN '${age1.age}'::INTERVAL AND '${age2.age}'::INTERVAL`
      } else {
        ageQuery = `act_utc - dob BETWEEN '${age2.age}'::INTERVAL AND '${age1.age}'::INTERVAL`
      }
    } else {
      async.eachSeries(ages, (age, nxtAge) => {
        if(ageQuery) {
          ageQuery += ' and ' + `act_utc - dob ${age.operator} '${age.age}'::INTERVAL`
        } else {
          ageQuery += `act_utc - dob ${age.operator} '${age.age}'::INTERVAL`
        }
        return nxtAge()
      })
    }
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
      if(err) {
        winston.error(err)
        return callback([])
      }
      if(response && response.hasOwnProperty('rows')) {
        return callback(response.rows)
      } else {
        return callback([])
      }
    })
  },

  getAEFIData: (startDate, endDate, callback) => {
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
      if(err) {
        winston.error(err)
        return callback([])
      }
      if(response && response.hasOwnProperty('rows')) {
        return callback(response.rows)
      } else {
        return callback([])
      }
    })
  },

  getColdChainData: (year_month, callback) => {
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
      if(err) {
        winston.error(err)
        return callback([])
      }
      if(response && response.hasOwnProperty('rows')) {
        return callback(response.rows)
      } else {
        return callback([])
      }
    })
  },

  getBreastFeedingData: (ages, startDate, endDate, callback) => {
    let ageQuery = ''
    async.eachSeries(ages, (age, nxtAge) => {
      if(ageQuery) {
        ageQuery += 'and ' + `pat_vw.dob - pat_vw.crt_utc ${age.operator} '${age.age}'::INTERVAL`
      } else {
        ageQuery += `pat_vw.dob - pat_vw.crt_utc ${age.operator} '${age.age}'::INTERVAL`
      }
      return nxtAge()
    })
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
      if(err) {
        winston.error(err)
        return callback([])
      }
      if(response && response.hasOwnProperty('rows')) {
        return callback(response.rows)
      } else {
        return callback([])
      }
    })
  },

  getPMTCTData: (startDate, endDate, callback) => {
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
      crt_utc::DATE between '${startDate}' and '${endDate}' and (ext_value='0' or ext_value='1')
    group by 
      ext_id, ebf.ext_value, pat_vw.gender_mnemonic order by ext_id`

    pool.query(query, (err, response) => {
      if(err) {
        winston.error(err)
        return callback([])
      }
      if(response && response.hasOwnProperty('rows')) {
        return callback(response.rows)
      } else {
        return callback([])
      }
    })
  },

  getTTData: (startDate, endDate, callback) => {
    let query = `select 
      ext_id as facility_id,
      pat_vw.gender_mnemonic,
      ebf.ext_value,
      count(*) as total
    from 
      pat_vw 
      inner join ent_ext_tbl as ebf on (pat_vw.pat_id = ebf.ent_id and ebf.ext_typ = 'http://openiz.org/extensions/patient/contrib/timr/tetanusStatus')
      inner join fac_id_tbl on (fac_id_tbl.fac_id = pat_vw.fac_id and nsid = 'TZ_HFR_ID')
    where 
      crt_utc::DATE between '${startDate}' and '${endDate}' and (ext_value='0' or ext_value='1' or ext_value='2')
    group by 
      ext_id, ebf.ext_value, pat_vw.gender_mnemonic order by ext_id`
    pool.query(query, (err, response) => {
      if(err) {
        winston.error(err)
        return callback([])
      }
      if(response && response.hasOwnProperty('rows')) {
        return callback(response.rows)
      } else {
        return callback([])
      }
    })
  },

  getChildrUsingMosqNetAtRegData: (startDate, endDate, callback) => {
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
      if(err) {
        winston.error(err)
        return callback([])
      }
      if(response && response.hasOwnProperty('rows')) {
        return callback(response.rows)
      } else {
        return callback([])
      }
    })
  },
  
  getDispLLINMosqNet: (startDate, endDate, callback) => {
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
      if(err) {
        winston.error(err)
        return callback([])
      }
      if(response && response.hasOwnProperty('rows')) {
        return callback(response.rows)
      } else {
        return callback([])
      }
    })
  },

  getStockONHAND: (firstDateNewMonth, callback) => {
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
      if(err) {
        winston.error(err)
        return callback([])
      }
      if(response && response.hasOwnProperty('rows')) {
        return callback(response.rows)
      } else {
        return callback([])
      }
    })
  },

  getStockAdjustments: (startDate, endDate) => {
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
      if(err) {
        winston.error(err)
        return callback([])
      }
      if(response && response.hasOwnProperty('rows')) {
        return callback(response.rows)
      } else {
        return callback([])
      }
    })
  }
}