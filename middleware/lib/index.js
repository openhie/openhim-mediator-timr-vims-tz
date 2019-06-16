require('./init');
const cluster = require('cluster');
const express = require('express');
const bodyParser = require('body-parser');
const {
  Pool
} = require('pg')
const cors = require('cors');
const async = require('async')
const winston = require('winston');
const config = require('./config');

const app = express();
const server = require('http').createServer(app);

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'timrdwh_latest',
  password: 'tajiri',
  port: 5432,
})

app.use(cors({
  origin: true,
  credentials: true
}));

app.use(bodyParser.urlencoded({
  extended: true,
}));
app.use(bodyParser.json());

if (cluster.isMaster) {
  var workers = {};
  var numWorkers = require('os').cpus().length;
  console.log('Master cluster setting up ' + numWorkers + ' workers...');

  for (var i = 0; i < numWorkers; i++) {
    const worker = cluster.fork();
    workers[worker.process.pid] = worker;
  }

  cluster.on('online', function (worker) {
    console.log('Worker ' + worker.process.pid + ' is online');
  });

  cluster.on('exit', function (worker, code, signal) {
    console.log('Worker ' + worker.process.pid + ' died with code: ' + code + ', and signal: ' + signal);
    delete(workers[worker.process.pid]);
    console.log('Starting a new worker');
    const newworker = cluster.fork();
    workers[newworker.process.pid] = newworker;
  });
  cluster.on('message', (worker, message) => {
    winston.info('Master received message from ' + worker.process.pid);
    if (message.content === 'clean') {
      for (let i in workers) {
        if (workers[i].process.pid !== worker.process.pid) {
          workers[i].send(message);
        } else {
          winston.info("Not sending clean message to self: " + i);
        }
      }
    }
  });
} else {
  process.on('message', (message) => {
    if (message.content === 'clean') {
      winston.info(process.pid + " received clean message from master.")
      mcsd.cleanCache(message.url, true)
    }
  })

  app.get('/immunization', (req, res) => {
    let seq_id = req.query.doseSequence
    let vaccine = req.query.vaccineCode
    let fac_id = req.query.fac_id
    let fac_name = req.query.fac_name
    let gender = req.query.gender //e.g Male or Female
    let incatchment = req.query.inCatchment // True or False
    let vaccineStartDate = req.query.vaccineStartDate
    let vaccineEndDate = req.query.vaccineEndDate
    let catchmentQuery = ''
    if (incatchment) {
      catchmentQuery = `and act_id in (select act_id from act_tag_tbl where tag_name='catchmentIndicator' and tag_value='${incatchment}')`
    }
    let query = `select count(*) from sbadm_tbl where seq_id=${seq_id} and mat_id in (select mat_id from mat_tbl where type_mnemonic='${vaccine}') and fac_id in (select fac_id from fac_id_tbl where ext_id='${fac_id}' and nsid='TZ_HFR_ID') and pat_id in (select pat_id from pat_tbl where gender_mnemonic='${gender}') ${catchmentQuery} and act_utc between '${vaccineStartDate}' and '${vaccineEndDate}'`
    winston.info("received a request to get immunization coverage for facility " + fac_name)
    pool.query(query, (err, response) => {
      if(response && response.hasOwnProperty('rows')) {
        res.status(200).json(response.rows[0])
      } else {
        res.status(200).send()
      }
    })
  })

  app.get('/ImmunizationByAge', (req, res) => {
    let seq_id = req.query.doseSequence
    let vaccine = req.query.vaccineCode
    let fac_id = req.query.fac_id
    let fac_name = req.query.fac_name
    let gender = req.query.gender //e.g Male or Female
    let incatchment = req.query.inCatchment // True or False
    let startDate = req.query.startDate
    let endDate = req.query.endDate
    let birthDate = req.query.birthDate


    let birthDate1, birthDate2
    if (Array.isArray(birthDate)) {
      birthDate1 = birthDate[0]
      birthDate2 = birthDate[1]
    } else {
      birthDate1 = birthDate
      birthDate2 = null
    }
    winston.info("received a request to get immunization coverage by age group for facility " + fac_name)
    async.parallel([
        function (callback) {
          translateFHIROperator(birthDate1, (operator, date) => {
            birthDate1 = `dob ${operator} '${date}'`
            callback(null, birthDate1)
          })
        },
        function (callback) {
          if (!birthDate2) {
            birthDate2 = ''
            return callback(null, birthDate2)
          }
          translateFHIROperator(birthDate2, (operator, date) => {
            birthDate2 = `and dob ${operator} '${date}'`
            callback(null, birthDate2)
          })
        }
      ],
      function (err, results) {
        let query = `select count(*) from sbadm_tbl where seq_id=${seq_id} and mat_id in (select mat_id from mat_tbl where type_mnemonic='${vaccine}') and fac_id in (select fac_id from fac_id_tbl where ext_id='${fac_id}' and nsid='TZ_HFR_ID') and pat_id in (select pat_id from pat_tbl where gender_mnemonic='${gender}' and psn_id in (select psn_id from psn_tbl where ${birthDate1} ${birthDate2})) and act_id in (select act_id from act_tag_tbl where tag_name='catchmentIndicator' and tag_value='${incatchment}') and act_utc between '${startDate}' and '${endDate}'`
        pool.query(query, (err, response) => {
          if(response && response.hasOwnProperty('rows')) {
            res.status(200).json(response.rows[0])
          } else {
            res.status(200).send()
          }
        })
      })
  })

  app.get('/supplements', (req, res) => {
    let code = req.query.suppCode
    let fac_id = req.query.fac_id
    let fac_name = req.query.fac_name
    let gender = req.query.gender //e.g Male or Female
    let suppStartDate = req.query.suppStartDate
    let suppEndDate = req.query.suppEndDate
    let startBirthDate = req.query.startBirthDate
    let endBirthDate = req.query.endBirthDate
    let query = `select count(*) from sbadm_tbl where mat_id in (select mat_id from mat_tbl where type_mnemonic='${code}') and fac_id in (select fac_id from fac_id_tbl where ext_id='${fac_id}' and nsid='TZ_HFR_ID') and pat_id in (select pat_id from pat_tbl where gender_mnemonic='${gender}') and pat_id in (select psn_id from psn_tbl where dob between '${startBirthDate}' and '${endBirthDate}') and act_utc between '${suppStartDate}' and '${suppEndDate}'`
    pool.query(query, (err, response) => {
      if(response && response.hasOwnProperty('rows')) {
        res.status(200).json(response.rows[0])
      } else {
        res.status(200).send()
      }
    })
  })

  app.get('/disease', (req, res) => {
    let code = req.query.diseaseCode
    let condition = req.query.diseaseCond
    let fac_id = req.query.fac_id
    let fac_name = req.query.fac_name
    let startDate = req.query.startDate
    let endDate = req.query.endDate
    let query = `select count(*) from cond_tbl where typ_mnemonic='${condition}' and prob_mnemonic='${code}' and fac_id in (select fac_id from fac_id_tbl where ext_id='${fac_id}' and nsid='TZ_HFR_ID') and act_utc between '${startDate}' and '${endDate}'`
    pool.query(query, (err, response) => {
      if(response && response.hasOwnProperty('rows')) {
        res.status(200).json(response.rows[0])
      } else {
        res.status(200).send()
      }
    })
  })

  app.get('/aefi', (req, res) => {
    let code = req.query.vaccCode
    let fac_id = req.query.fac_id
    let fac_name = req.query.fac_name
    let startDate = req.query.startDate
    let endDate = req.query.endDate
    let query = `select count(*) from sbadm_tbl where mat_id in (select mat_id from mat_tbl where type_mnemonic='${code}') and fac_id in (select fac_id from fac_id_tbl where ext_id='${fac_id}' and nsid='TZ_HFR_ID') and pat_id in (select pat_id from pat_tbl where gender_mnemonic='${gender}') and pat_id in (select psn_id from psn_tbl where dob between '${startBirthDate}' and '${endBirthDate}') and act_utc between '${startDate}' and '${endDate}'`
    pool.query(query, (err, response) => {
      if(response && response.hasOwnProperty('rows')) {
        res.status(200).json(response.rows[0])
      } else {
        res.status(200).send()
      }
    })
  })

  app.get('/breastFeeding', (req, res) => {
    let code = req.query.breastFeedingCode
    let fac_id = req.query.fac_id
    let fac_name = req.query.fac_name
    let gender = req.query.gender
    let startDate = req.query.startDate
    let endDate = req.query.endDate
    let birthDate = req.query.birthDate


    let birthDate1, birthDate2
    if (Array.isArray(birthDate)) {
      birthDate1 = birthDate[0]
      birthDate2 = birthDate[1]
    } else {
      birthDate1 = birthDate
      birthDate2 = null
    }

    async.parallel([
      function (callback) {
        translateFHIROperator(birthDate1, (operator, date) => {
          birthDate1 = `dob ${operator} '${date}'`
          callback(null, birthDate1)
        })
      },
      function (callback) {
        if (!birthDate2) {
          birthDate2 = ''
          return callback(null, birthDate2)
        }
        translateFHIROperator(birthDate2, (operator, date) => {
          birthDate2 = `and dob ${operator} '${date}'`
          callback(null, birthDate2)
        })
      }
    ],
    function (err, results) {
      let query = `select count(*) from pat_ext_tbl where ext_value='${code}' and ext_typ='http://openiz.org/extensions/patient/contrib/timr/breastFeedingStatus' and pat_id in (select pat_id from pat_tbl where gender_mnemonic='${gender}' and asgn_fac_id in (select fac_id from fac_id_tbl where ext_id='${fac_id}' and nsid='TZ_HFR_ID') and psn_id in (select psn_id from psn_tbl where ${birthDate1} ${birthDate2} and crt_utc between '${startDate}' and '${endDate}'))`
      pool.query(query, (err, response) => {
        if(response && response.hasOwnProperty('rows')) {
          res.status(200).json(response.rows[0])
        } else {
          res.status(200).send()
        }
      })
    })
  })

  app.get('/childVisit', (req, res) => {
    let code = req.query.breastFeedingCode
    let fac_id = req.query.fac_id
    let fac_name = req.query.fac_name
    let gender = req.query.gender
    let startDate = req.query.startDate
    let endDate = req.query.endDate
    let birthDate = req.query.birthDate


    let birthDate1, birthDate2
    if (Array.isArray(birthDate)) {
      birthDate1 = birthDate[0]
      birthDate2 = birthDate[1]
    } else {
      birthDate1 = birthDate
      birthDate2 = null
    }

    async.parallel([
      function (callback) {
        translateFHIROperator(birthDate1, (operator, date) => {
          birthDate1 = `dob ${operator} '${date}'`
          callback(null, birthDate1)
        })
      },
      function (callback) {
        if (!birthDate2) {
          birthDate2 = ''
          return callback(null, birthDate2)
        }
        translateFHIROperator(birthDate2, (operator, date) => {
          birthDate2 = `and dob ${operator} '${date}'`
          callback(null, birthDate2)
        })
      }
    ],
    function (err, results) {
      let query = `select count(*) from enc_tbl where pat_id in (select pat_id from pat_vw where gender_mnemonic='${gender}' and fac_id in (select fac_id from fac_id_tbl where ext_id='${fac_id}' and nsid='TZ_HFR_ID') and ${birthDate1} ${birthDate2}) and crt_utc between '${startDate}' and '${endDate}'`
      winston.error(query)
      pool.query(query, (err, response) => {
        if(response && response.hasOwnProperty('rows')) {
          res.status(200).json(response.rows[0])
        } else {
          res.status(200).send()
        }
      })
    })
  })

  app.get('/pmtct', (req, res) => {
    let status = req.query.status
    let fac_id = req.query.fac_id
    let fac_name = req.query.fac_name
    let gender = req.query.gender
    let startDate = req.query.startDate
    let endDate = req.query.endDate
    let query = `select count(*) from pat_ext_tbl where ext_value='${status}' and ext_typ='http://openiz.org/extensions/patient/contrib/timr/pctmtStatus' and pat_id in (select pat_id from pat_tbl where gender_mnemonic='${gender}' and asgn_fac_id in (select fac_id from fac_id_tbl where ext_id='${fac_id}' and nsid='TZ_HFR_ID') and psn_id in (select psn_id from psn_tbl where crt_utc between '${startDate}' and '${endDate}'))`
    pool.query(query, (err, response) => {
      if(response && response.hasOwnProperty('rows')) {
        res.status(200).json(response.rows[0])
      } else {
        res.status(200).send()
      }
    })
  })

  app.get('/mosquitoNet', (req, res) => {
    let fac_id = req.query.fac_id
    let fac_name = req.query.fac_name
    let gender = req.query.gender
    let startDate = req.query.startDate
    let endDate = req.query.endDate
    let query = `select count(*) from pat_ext_tbl where ext_value='True' and ext_typ='http://openiz.org/extensions/patient/contrib/timr/mosquitoNetStatus' and pat_id in (select pat_id from pat_tbl where gender_mnemonic='${gender}' and asgn_fac_id in (select fac_id from fac_id_tbl where ext_id='${fac_id}' and nsid='TZ_HFR_ID') and psn_id in (select psn_id from psn_tbl where crt_utc between '${startDate}' and '${endDate}'))`
    pool.query(query, (err, response) => {
      if (err) {
        winston.error(err)
        res.status(400).json()
        return
      }
      if(response && response.hasOwnProperty('rows')) {
        res.status(200).json(response.rows[0])
      } else {
        res.status(200).send()
      }
    })
  })

  app.get('/TTData', (req, res) => {
    let fac_id = req.query.fac_id
    let fac_name = req.query.fac_name
    let ttstatus = req.query.ttstatus
    let gender = req.query.gender
    let startDate = req.query.startDate
    let endDate = req.query.endDate
    let query = `select count(*) from pat_ext_tbl where ext_value='${ttstatus}' and ext_typ='http://openiz.org/extensions/patient/contrib/timr/tetanusStatus' and pat_id in (select pat_id from pat_tbl where gender_mnemonic='${gender}' and asgn_fac_id in (select fac_id from fac_id_tbl where ext_id='${fac_id}' and nsid='TZ_HFR_ID') and psn_id in (select psn_id from psn_tbl where crt_utc between '${startDate}' and '${endDate}'))`
    winston.error(query)
    pool.query(query, (err, response) => {
      if (err) {
        winston.error(err)
        res.status(400).json()
        return
      }
      if(response && response.hasOwnProperty('rows')) {
        res.status(200).json(response.rows[0])
      } else {
        res.status(200).send()
      }
    })
  })

  app.get('/ageWeightRatio', (req, res) => {
    let code = req.query.code
    let fac_id = req.query.fac_id
    let fac_name = req.query.fac_name
    let gender = req.query.gender
    let startDate = req.query.startDate
    let endDate = req.query.endDate
    let birthDate = req.query.birthDate
    let birthDate1, birthDate2
    if (Array.isArray(birthDate)) {
      birthDate1 = birthDate[0]
      birthDate2 = birthDate[1]
    } else {
      birthDate1 = birthDate
      birthDate2 = null
    }

    async.parallel([
        function (callback) {
          translateFHIROperator(birthDate1, (operator, date) => {
            birthDate1 = `dob ${operator} '${date}'`
            callback(null, birthDate1)
          })
        },
        function (callback) {
          if (!birthDate2) {
            birthDate2 = ''
            return callback(null, birthDate2)
          }
          translateFHIROperator(birthDate2, (operator, date) => {
            birthDate2 = `and dob ${operator} '${date}'`
            callback(null, birthDate2)
          })
        }
      ],
      function (err, results) {
        let query = `select count(*) from qty_obs_tbl where int_cs='${code}' and typ_cs='VitalSign-Weight' and crt_utc between '${startDate}' and '${endDate}' and fac_id in (select fac_id from fac_id_tbl where ext_id='${fac_id}' and nsid='TZ_HFR_ID') and pat_id in (select pat_id from pat_tbl where gender_mnemonic='${gender}' and psn_id in (select psn_id from psn_tbl where ${birthDate1} ${birthDate2}))`
        pool.query(query, (err, response) => {
          if(response && response.hasOwnProperty('rows')) {
            res.status(200).json(response.rows[0])
          } else {
            res.status(200).send()
          }
        })
      })
  })

  function translateFHIROperator(data, callback) {
    let operator
    if (data.includes('gt')) {
      data = data.replace('gt', '')
      operator = '>'
    } else if (data.includes('ge')) {
      data = data.replace('ge', '')
      operator = '>='
    } else if (data.includes('lt')) {
      data = data.replace('lt', '')
      operator = '<'
    } else if (data.includes('le')) {
      data = data.replace('le', '')
      dobQuery = '<='
    }
    return callback(operator, data)
  }

  server.listen(config.getConf('server:port'));
  winston.info(`Server is running and listening on port ${config.getConf('server:port')}`);
}