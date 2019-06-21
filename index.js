#!/usr/bin/env node

'use strict'

const express = require('express')
const medUtils = require('openhim-mediator-utils')
const utils = require('./utils')
const winston = require('winston')
const moment = require("moment")
const request = require('request')
const isJSON = require('is-json')
const SENDEMAIL = require('./send_email')
const send_email = SENDEMAIL()
const URI = require('urijs')
const XmlReader = require('xml-reader')
const xmlQuery = require('xml-query')
const TImR = require('./timr')
const VIMS = require('./vims')
const mixin = require('./mixin')
const middleware = require('./middleware')
const OIM = require('./openinfoman')
const SMSAGGREGATOR = require('./smsAggregator')
const async = require('async')
const bodyParser = require('body-parser')
const xmlparser = require('express-xml-bodyparser')
var events = require('events')
var eventEmitter = new events.EventEmitter()
var Spinner = require('cli-spinner').Spinner

const port = 9000
const vimsDiseaseValueSet = require('./terminologies/vims-diseases-valuesets.json')
const vimsImmValueSets = require('./terminologies/vims-immunization-valuesets.json')
const vimsVitaminValueSets = require('./terminologies/vims-vitamin-valuesets.json')
const vimsItemsValueSets = require('./terminologies/vims-items-valuesets.json')
const timrVimsDwhImmConceptMap = require('./terminologies/timr-vims-dwh-immunization-conceptmap.json')
const imm_doses = require("./config/doses.json")
const vacc_doses_mapping = require("./config/vaccine-doses-mapping.json")
const vacc_diseases_mapping = require("./config/vaccine-diseases-mapping.json")

// Config
var config = {} // this will vary depending on whats set in openhim-core
const apiConf = require('./config/config')
const mediatorConfig = require('./config/mediator')

// socket config - large documents can cause machine to max files open
const https = require('https')
const http = require('http')

https.globalAgent.maxSockets = 32
http.globalAgent.maxSockets = 32

// Logging setup
winston.remove(winston.transports.Console)
winston.add(winston.transports.Console, {
  level: 'info',
  timestamp: true,
  colorize: true
})

//set environment variable so that the mediator can be registered
process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = 0;

/**
 * setupApp - configures the http server for this mediator
 *
 * @return {express.App}  the configured http server
 */
function setupApp() {
  const app = express()
  app.use(xmlparser())
  var rawBodySaver = function (req, res, buf, encoding) {
    if (buf && buf.length) {
      req.rawBody = buf.toString(encoding || 'utf8');
    }
  }
  app.use(bodyParser.raw({
    verify: rawBodySaver,
    type: '*/*'
  }));
  app.use(bodyParser.urlencoded({
    extended: true
  }))
  app.use(bodyParser.json())

  function getOpenHimTransationData(transactionId, callback) {
    medUtils.authenticate(apiConf.api, function (err) {
      if (err) {
        return winston.error(err.stack);
      }
      var headers = medUtils.genAuthHeaders(apiConf.api)
      var options = {
        url: apiConf.api.apiURL + '/transactions/' + transactionId,
        headers: headers
      }
      request.get(options, function (err, apiRes, body) {
        if (err) {
          return winston.error(err);
        }
        if (apiRes.statusCode !== 200) {
          return winston.error(new Error('Unable to get transaction data from OpenHIM-core, received status code ' + apiRes.statusCode + ' with body ' + body).stack);
        }
        callback(body)
      })

    })
  }

  function updateTransaction(req, body, statatusText, statusCode, orchestrations) {
    const transactionId = req.headers['x-openhim-transactionid']
    var update = {
      'x-mediator-urn': mediatorConfig.urn,
      status: statatusText,
      response: {
        status: statusCode,
        timestamp: new Date(),
        body: body
      },
      orchestrations: orchestrations
    }
    medUtils.authenticate(apiConf.api, function (err) {
      if (err) {
        return winston.error(err.stack);
      }
      var headers = medUtils.genAuthHeaders(apiConf.api)
      var options = {
        url: apiConf.api.apiURL + '/transactions/' + transactionId,
        headers: headers,
        json: update
      }

      request.put(options, function (err, apiRes, body) {
        if (err) {
          return winston.error(err);
        }
        if (apiRes.statusCode !== 200) {
          return winston.error(new Error('Unable to save updated transaction to OpenHIM-core, received status code ' + apiRes.statusCode + ' with body ' + body).stack);
        }
        winston.info('Successfully updated transaction with id ' + transactionId);
      });
    })
  }

  app.get('/syncImmunizationCoverage', (req, res) => {
    const oim = OIM(config.openinfoman)
    const vims = VIMS(config.vims, '', config.timr, config.timrOauth2)
    res.end()
    updateTransaction(req, "Still Processing", "Processing", "200", "")
    req.timestamp = new Date()
    let orchestrations = []

    oim.getVimsFacilities(orchestrations, (err, facilities) => {
      vims.getFacilityWithLatestPeriod(facilities, (period) => {
        var startDate = '2019-06-01'//moment(period.periodName, "MMM YYYY").startOf('month').format("YYYY-MM-DD")
        var endDate = '2019-06-30'//moment(period.periodName, "MMM YYYY").endOf('month').format('YYYY-MM-DD')
        middleware.getImmunizationCoverage(startDate, endDate, (rows) => {
          if(rows.length === 0) {
            winston.info("No Immunization Coverage data found on TImR for period " + period.periodName)
            return
          }
          async.eachSeries(facilities, (facility, nxtFacility) => {
            winston.info("Sync Immunization Coverage data for " + facility.facilityName)
            if(facility.periodId) {
              mixin.extractFacilityData(facility.timrFacilityId, rows, (facData) => {
                if(facData.length > 0) {
                  vims.saveImmunizationData(facData, facility, orchestrations, () => {
                    winston.info("Done synchronizing Immunization Coverage data" + " for " + facility.facilityName)
                    return nxtFacility()
                  })
                } else {
                  winston.info("No data for " + facility.facilityName + " Skip processing Immunization Coverage data")
                  return nxtFacility()
                }
              })
            } else {
              winston.warn("No DRAFT Report for " + facility.facilityName + " Skip processing Immunization Coverage data")
              return nxtFacility()
            }
          }, () => {
            winston.info("Done synchronizing Immunization Coverage data")
          })
        })
      })
    })
  }),

    app.get('/syncSupplements', (req, res) => {
      const oim = OIM(config.openinfoman)
      const vims = VIMS(config.vims, '', config.timr, config.timrOauth2)
      res.end()
      updateTransaction(req, "Still Processing", "Processing", "200", "")
      req.timestamp = new Date()
      let orchestrations = []

      oim.getVimsFacilities(orchestrations, (err, facilities) => {
        vims.getFacilityWithLatestPeriod(facilities, (period) => {
          if ((Object.keys(period).length) == 0) {
            winston.warn("No facility with DRAFT report, stop Supplements data sync")
            return res.status(200).send()
          }
          var startDate = moment(period.periodName, "MMM YYYY").startOf('month').format("YYYY-MM-DD")
          var endDate = moment(period.periodName, "MMM YYYY").endOf('month').format('YYYY-MM-DD')
          vims.getReport(period.periodId, orchestrations, (err, report) => {
            vims.extractAgeGroups(report.report.vitaminSupplementationLineItems).then((ageGroups) => {
              async.each(ageGroups, (vimsAgeGroup, nxtAgegrp) => {
                mixin.translateAgeGroup(vimsAgeGroup, (timrAgeGroup) => {
                  middleware.getSupplementsData(timrAgeGroup, startDate, endDate, (rows) => {
                    if(rows.length === 0) {
                      winston.info("No Supplements data found on TImR for period " + period.periodName)
                      return
                    }
                    async.eachSeries(facilities, (facility, nxtFacility) => {
                      winston.info("Sync Supplements data for " + facility.facilityName + ' Age group ' + vimsAgeGroup)
                      if(facility.periodId) {
                        mixin.extractFacilityData(facility.timrFacilityId, rows, (facData) => {
                          if(facData.length > 0) {
                            vims.saveSupplements(facData, facility, vimsAgeGroup, orchestrations, () => {
                              winston.info("Done synchronizing Supplements data age group " + vimsAgeGroup + " for " + facility.facilityName)
                              return nxtFacility()
                            })
                          } else {
                            winston.info("No data for " + facility.facilityName + " Skip processing Supplements data age group " + vimsAgeGroup)
                            return nxtFacility()
                          }
                        })
                      } else {
                        winston.warn("No DRAFT Report for " + facility.facilityName + " Skip processing Supplements data")
                        return nxtFacility()
                      }
                    }, () => {
                      return nxtAgegrp()
                    })
                  })
                })
              }, () => {
                winston.info("Done synchronizing Supplements data")
              })
            })
          })
        })
      })
    }),

    app.get('/syncAdverseEffects', (req, res) => {
      const oim = OIM(config.openinfoman)
      const vims = VIMS(config.vims, '', config.timr, config.timrOauth2)
      res.end()
      updateTransaction(req, "Still Processing", "Processing", "200", "")
      req.timestamp = new Date()
      let orchestrations = []

      oim.getVimsFacilities(orchestrations, (err, facilities) => {
        vims.getFacilityWithLatestPeriod(facilities, (period) => {
          var startDate = moment(period.periodName, "MMM YYYY").startOf('month').format("YYYY-MM-DD")
          var endDate = moment(period.periodName, "MMM YYYY").endOf('month').format('YYYY-MM-DD')
          middleware.getAEFIData(startDate, endDate, (rows) => {
            if(rows.length === 0) {
              winston.info("No AEFI data found on TImR for period " + period.periodName)
              return
            }
            async.eachSeries(facilities, (facility, nxtFacility) => {
              winston.info("Sync AEFI data for " + facility.facilityName)
              if(facility.periodId) {
                mixin.extractFacilityData(facility.timrFacilityId, rows, (facData) => {
                  if(facData.length > 0) {
                    vims.saveAdverseEffectData(facData, facility, orchestrations, () => {
                      winston.info("Done synchronizing AEFI data" + " for " + facility.facilityName)
                      return nxtFacility()
                    })
                  } else {
                    winston.info("No data for " + facility.facilityName + " Skip processing AEFI data")
                    return nxtFacility()
                  }
                })
              } else {
                winston.warn("No DRAFT Report for " + facility.facilityName + " Skip processing AEFI data")
                return nxtFacility()
              }
            }, () => {
              winston.info("Done synchronizing AEFI data")
            })
          })
        })
      })
    })

    app.get('/syncDiseases', (req, res) => {
      const oim = OIM(config.openinfoman)
      const vims = VIMS(config.vims, '', config.timr, config.timrOauth2)
      res.end()
      updateTransaction(req, "Still Processing", "Processing", "200", "")
      req.timestamp = new Date()
      let orchestrations = []

      oim.getVimsFacilities(orchestrations, (err, facilities) => {
        vims.getFacilityWithLatestPeriod(facilities, (period) => {
          var startDate = moment(period.periodName, "MMM YYYY").startOf('month').format("YYYY-MM-DD")
          var endDate = moment(period.periodName, "MMM YYYY").endOf('month').format('YYYY-MM-DD')
          middleware.getDiseaseData(startDate, endDate, (rows) => {
            if(rows.length === 0) {
              winston.info("No Disease data found on TImR for period " + period.periodName)
              return
            }
            async.eachSeries(facilities, (facility, nxtFacility) => {
              winston.info("Sync Disease data for " + facility.facilityName)
              if(facility.periodId) {
                mixin.extractFacilityData(facility.timrFacilityId, rows, (facData) => {
                  if(facData.length > 0) {
                    vims.saveDiseaseData(facData, facility, orchestrations, () => {
                      winston.info("Done synchronizing Disease data" + " for " + facility.facilityName)
                      return nxtFacility()
                    })
                  } else {
                    winston.info("No data for " + facility.facilityName + " Skip processing Disease data")
                    return nxtFacility()
                  }
                })
              } else {
                winston.warn("No DRAFT Report for " + facility.facilityName + " Skip processing Disease data")
                return nxtFacility()
              }
            }, () => {
              winston.info("Done synchronizing Disease data")
            })
          })
        })
      })
    }),

    app.get('/syncBreastFeeding', (req, res) => {
      const oim = OIM(config.openinfoman)
      const vims = VIMS(config.vims, '', config.timr, config.timrOauth2)
      res.end()
      updateTransaction(req, "Still Processing", "Processing", "200", "")
      req.timestamp = new Date()
      let orchestrations = []

      oim.getVimsFacilities(orchestrations, (err, facilities) => {
        vims.getFacilityWithLatestPeriod(facilities, (period) => {
          if ((Object.keys(period).length) == 0) {
            winston.warn("No facility with DRAFT report, stop breast feeding data sync")
            return res.status(200).send()
          }
          var startDate = moment(period.periodName, "MMM YYYY").startOf('month').format("YYYY-MM-DD")
          var endDate = moment(period.periodName, "MMM YYYY").endOf('month').format('YYYY-MM-DD')
          vims.getReport(period.periodId, orchestrations, (err, report) => {
            vims.extractAgeGroups(report.report.breastFeedingLineItems).then((ageGroups) => {
              async.each(ageGroups, (vimsAgeGroup, nxtAgegrp) => {
                mixin.translateAgeGroup(vimsAgeGroup, (timrAgeGroup) => {
                  middleware.getBreastFeedingData(timrAgeGroup, startDate, endDate, (rows) => {
                    if(rows.length === 0) {
                      winston.info("No Breast Feeding data found on TImR for period " + period.periodName)
                      return
                    }
                    async.eachSeries(facilities, (facility, nxtFacility) => {
                      winston.info("Sync breast feeding data for " + facility.facilityName)
                      if(facility.periodId) {
                        mixin.extractFacilityData(facility.timrFacilityId, rows, (facData) => {
                          if(facData.length > 0) {
                            vims.saveBreastFeeding(facData, facility, vimsAgeGroup, orchestrations, () => {
                              winston.info("Done synchronizing breast feeding data age group " + vimsAgeGroup + " for " + facility.facilityName)
                              return nxtFacility()
                            })
                          } else {
                            winston.info("No data for " + facility.facilityName + " Skip processing breast feeding data age group " + vimsAgeGroup)
                            return nxtFacility()
                          }
                        })
                      } else {
                        winston.warn("No DRAFT Report for " + facility.facilityName + " Skip processing breast feeding data")
                        return nxtFacility()
                      }
                    }, () => {
                      return nxtAgegrp()
                    })
                  })
                })
              }, () => {
                winston.info("Done synchronizing breast feeding data")
              })
            })
          })
        })
      })
    })

    app.get('/syncPMTCT', (req, res) => {
      const oim = OIM(config.openinfoman)
      const vims = VIMS(config.vims, '', config.timr, config.timrOauth2)
      res.end()
      updateTransaction(req, "Still Processing", "Processing", "200", "")
      req.timestamp = new Date()
      let orchestrations = []

      oim.getVimsFacilities(orchestrations, (err, facilities) => {
        vims.getFacilityWithLatestPeriod(facilities, (period) => {
          var startDate = moment(period.periodName, "MMM YYYY").startOf('month').format("YYYY-MM-DD")
          var endDate = moment(period.periodName, "MMM YYYY").endOf('month').format('YYYY-MM-DD')
          middleware.getPMTCTData(startDate, endDate, (rows) => {
            if(rows.length === 0) {
              winston.info("No PMTCT data found on TImR for period " + period.periodName)
              return
            }
            async.eachSeries(facilities, (facility, nxtFacility) => {
              winston.info("Sync PMTCT data for " + facility.facilityName)
              if(facility.periodId) {
                mixin.extractFacilityData(facility.timrFacilityId, rows, (facData) => {
                  if(facData.length > 0) {
                    vims.savePMTCT(facData, facility, orchestrations, () => {
                      winston.info("Done synchronizing PMTCT data" + " for " + facility.facilityName)
                      return nxtFacility()
                    })
                  } else {
                    winston.info("No data for " + facility.facilityName + " Skip processing PMTCT data")
                    return nxtFacility()
                  }
                })
              } else {
                winston.warn("No DRAFT Report for " + facility.facilityName + " Skip processing PMTCT data")
                return nxtFacility()
              }
            }, () => {
              winston.info("Done synchronizing PMTCT data")
            })
          })
        })
      })
    })

    app.get('/syncMosquitoNet', (req, res) => {
      const oim = OIM(config.openinfoman)
      const vims = VIMS(config.vims, '', config.timr, config.timrOauth2)
      res.end()
      updateTransaction(req, "Still Processing", "Processing", "200", "")
      req.timestamp = new Date()
      let orchestrations = []

      oim.getVimsFacilities(orchestrations, (err, facilities) => {
        vims.getFacilityWithLatestPeriod(facilities, (period) => {
          var startDate = moment(period.periodName, "MMM YYYY").startOf('month').format("YYYY-MM-DD")
          var endDate = moment(period.periodName, "MMM YYYY").endOf('month').format('YYYY-MM-DD')
          middleware.getDispLLINMosqNet(startDate, endDate, (rows) => {
            if(rows.length === 0) {
              winston.info("No MosquitoNet data found on TImR for period " + period.periodName)
              return
            }
            async.eachSeries(facilities, (facility, nxtFacility) => {
              winston.info("Sync MosquitoNet data for " + facility.facilityName)
              if(facility.periodId) {
                mixin.extractFacilityData(facility.timrFacilityId, rows, (facData) => {
                  if(facData.length > 0) {
                    vims.saveMosquitoNet(facData, facility, orchestrations, () => {
                      winston.info("Done synchronizing MosquitoNet data" + " for " + facility.facilityName)
                      return nxtFacility()
                    })
                  } else {
                    winston.info("No data for " + facility.facilityName + " Skip processing MosquitoNet data")
                    return nxtFacility()
                  }
                })
              } else {
                winston.warn("No DRAFT Report for " + facility.facilityName + " Skip processing MosquitoNet data")
                return nxtFacility()
              }
            }, () => {
              winston.info("Done synchronizing MosquitoNet data")
            })
          })
        })
      })
    })

    app.get('/syncTT', (req, res) => {
      const oim = OIM(config.openinfoman)
      const vims = VIMS(config.vims, '', config.timr, config.timrOauth2)
      res.end()
      updateTransaction(req, "Still Processing", "Processing", "200", "")
      req.timestamp = new Date()
      let orchestrations = []

      oim.getVimsFacilities(orchestrations, (err, facilities) => {
        vims.getFacilityWithLatestPeriod(facilities, (period) => {
          var startDate = moment(period.periodName, "MMM YYYY").startOf('month').format("YYYY-MM-DD")
          var endDate = moment(period.periodName, "MMM YYYY").endOf('month').format('YYYY-MM-DD')
          middleware.getTTData(startDate, endDate, (rows) => {
            if(rows.length === 0) {
              winston.info("No TT data found on TImR for period " + period.periodName)
              return
            }
            async.eachSeries(facilities, (facility, nxtFacility) => {
              winston.info("Sync TT data for " + facility.facilityName)
              if(facility.periodId) {
                mixin.extractFacilityData(facility.timrFacilityId, rows, (facData) => {
                  if(facData.length > 0) {
                    vims.saveTT(facData, facility, orchestrations, () => {
                      winston.info("Done synchronizing TT data" + " for " + facility.facilityName)
                      return nxtFacility()
                    })
                  } else {
                    winston.info("No data for " + facility.facilityName + " Skip processing TT data")
                    return nxtFacility()
                  }
                })
              } else {
                winston.warn("No DRAFT Report for " + facility.facilityName + " Skip processing TT data")
                return nxtFacility()
              }
            }, () => {
              winston.info("Done synchronizing TT data")
            })
          })
        })
      })
    })

    app.get('/syncChildVisit', (req, res) => {
      const oim = OIM(config.openinfoman)
      const vims = VIMS(config.vims, '', config.timr, config.timrOauth2)
      res.end()
      updateTransaction(req, "Still Processing", "Processing", "200", "")
      req.timestamp = new Date()
      let orchestrations = []

      oim.getVimsFacilities(orchestrations, (err, facilities) => {
        vims.getFacilityWithLatestPeriod(facilities, (period) => {
          if ((Object.keys(period).length) == 0) {
            winston.warn("No facility with DRAFT report, stop Child Visit data sync")
            return res.status(200).send()
          }
          var startDate = moment(period.periodName, "MMM YYYY").startOf('month').format("YYYY-MM-DD")
          var endDate = moment(period.periodName, "MMM YYYY").endOf('month').format('YYYY-MM-DD')
          vims.getReport(period.periodId, orchestrations, (err, report) => {
            vims.extractAgeGroups(report.report.childVisitLineItems).then((ageGroups) => {
              async.each(ageGroups, (vimsAgeGroup, nxtAgegrp) => {
                mixin.translateAgeGroup(vimsAgeGroup, (timrAgeGroup) => {
                  middleware.getChildVisitData(timrAgeGroup, startDate, endDate, (rows) => {
                    if(rows.length === 0) {
                      winston.info("No Child Visit data found on TImR for period " + period.periodName)
                      return
                    }
                    async.eachSeries(facilities, (facility, nxtFacility) => {
                      winston.info("Sync Child Visit data for " + facility.facilityName + ' Age group ' + vimsAgeGroup)
                      if(facility.periodId) {
                        mixin.extractFacilityData(facility.timrFacilityId, rows, (facData) => {
                          if(facData.length > 0) {
                            vims.saveChildVisit(facData, facility, vimsAgeGroup, orchestrations, () => {
                              winston.info("Done synchronizing Child Visit data age group " + vimsAgeGroup + " for " + facility.facilityName)
                              return nxtFacility()
                            })
                          } else {
                            winston.info("No data for " + facility.facilityName + " Skip processing Child Visit data age group " + vimsAgeGroup)
                            return nxtFacility()
                          }
                        })
                      } else {
                        winston.warn("No DRAFT Report for " + facility.facilityName + " Skip processing Child Visit data")
                        return nxtFacility()
                      }
                    }, () => {
                      return nxtAgegrp()
                    })
                  })
                })
              }, () => {
                winston.info("Done synchronizing Child Visit data")
              })
            })
          })
        })
      })
    }),

    app.get('/syncWeightAgeRatio', (req, res) => {
      const oim = OIM(config.openinfoman)
      const vims = VIMS(config.vims, '', config.timr, config.timrOauth2)
      res.end()
      updateTransaction(req, "Still Processing", "Processing", "200", "")
      req.timestamp = new Date()
      let orchestrations = []

      oim.getVimsFacilities(orchestrations, (err, facilities) => {
        vims.getFacilityWithLatestPeriod(facilities, (period) => {
          if ((Object.keys(period).length) == 0) {
            winston.warn("No facility with DRAFT report, stop Weight Age Ratio data sync")
            return res.status(200).send()
          }
          var startDate = moment(period.periodName, "MMM YYYY").startOf('month').format("YYYY-MM-DD")
          var endDate = moment(period.periodName, "MMM YYYY").endOf('month').format('YYYY-MM-DD')
          vims.getReport(period.periodId, orchestrations, (err, report) => {
            vims.extractAgeGroups(report.report.weightAgeRatioLineItems).then((ageGroups) => {
              async.each(ageGroups, (vimsAgeGroup, nxtAgegrp) => {
                mixin.translateAgeGroup(vimsAgeGroup, (timrAgeGroup) => {
                  middleware.getWeightAgeRatio(timrAgeGroup, startDate, endDate, (rows) => {
                    if(rows.length === 0) {
                      winston.info("No Weight Age Ratio data found on TImR for period " + period.periodName)
                      return
                    }
                    async.eachSeries(facilities, (facility, nxtFacility) => {
                      winston.info("Sync Weight Age Ratio data for " + facility.facilityName + ' Age group ' + vimsAgeGroup)
                      if(facility.periodId) {
                        mixin.extractFacilityData(facility.timrFacilityId, rows, (facData) => {
                          if(facData.length > 0) {
                            vims.saveWeightAgeRatio(facData, facility, vimsAgeGroup, orchestrations, () => {
                              winston.info("Done synchronizing Weight Age Ratio data age group " + vimsAgeGroup + " for " + facility.facilityName)
                              return nxtFacility()
                            })
                          } else {
                            winston.info("No data for " + facility.facilityName + " Skip processing Weight Age Ratio data age group " + vimsAgeGroup)
                            return nxtFacility()
                          }
                        })
                      } else {
                        winston.warn("No DRAFT Report for " + facility.facilityName + " Skip processing Weight Age Ratio data")
                        return nxtFacility()
                      }
                    }, () => {
                      return nxtAgegrp()
                    })
                  })
                })
              }, () => {
                winston.info("Done synchronizing Weight Age Ratio data")
              })
            })
          })
        })
      })
    }),

    app.get('/syncImmCovAgeGrp', (req, res) => {
      const oim = OIM(config.openinfoman)
      const vims = VIMS(config.vims, '', config.timr, config.timrOauth2)
      res.end()
      updateTransaction(req, "Still Processing", "Processing", "200", "")
      req.timestamp = new Date()
      let orchestrations = []

      oim.getVimsFacilities(orchestrations, (err, facilities) => {
        vims.getFacilityWithLatestPeriod(facilities, (period) => {
          if ((Object.keys(period).length) == 0) {
            winston.warn("No facility with DRAFT report, stop Immunization Coverage By Age data sync")
            return res.status(200).send()
          }
          var startDate = moment(period.periodName, "MMM YYYY").startOf('month').format("YYYY-MM-DD")
          var endDate = moment(period.periodName, "MMM YYYY").endOf('month').format('YYYY-MM-DD')
          vims.getReport(period.periodId, orchestrations, (err, report) => {
            vims.extractAgeGroups(report.report.coverageAgeGroupLineItems).then((ageGroups) => {
              if(ageGroups.length == 0) {
                winston.warn("No age group found, stop data sync for Immunization Coverage By Age")
              }
              async.each(ageGroups, (vimsAgeGroup, nxtAgegrp) => {
                mixin.translateAgeGroup(vimsAgeGroup, (timrAgeGroup) => {
                  middleware.getImmunizationCoverageByAge(timrAgeGroup, startDate, endDate, (rows) => {
                    if(rows.length === 0) {
                      winston.info("No Immunization Coverage By Age data found on TImR for period " + period.periodName)
                      return
                    }
                    async.eachSeries(facilities, (facility, nxtFacility) => {
                      winston.info("Sync Immunization Coverage By Age data for " + facility.facilityName + ' Age group ' + vimsAgeGroup)
                      if(facility.periodId) {
                        mixin.extractFacilityData(facility.timrFacilityId, rows, (facData) => {
                          if(facData.length > 0) {
                            vims.saveImmCoverAgeGrp(facData, facility, vimsAgeGroup, orchestrations, () => {
                              winston.info("Done synchronizing Immunization Coverage By Age data age group " + vimsAgeGroup + " for " + facility.facilityName)
                              return nxtFacility()
                            })
                          } else {
                            winston.info("No data for " + facility.facilityName + " Skip processing Immunization Coverage By Age data age group " + vimsAgeGroup)
                            return nxtFacility()
                          }
                        })
                      } else {
                        winston.warn("No DRAFT Report for " + facility.facilityName + " Skip processing Immunization Coverage By Age data")
                        return nxtFacility()
                      }
                    }, () => {
                      return nxtAgegrp()
                    })
                  })
                })
              }, () => {
                winston.info("Done synchronizing Immunization Coverage By Age data")
              })
            })
          })
        })
      })
    }),

    app.get('/syncStockOnHand', (req, res) => {
      const oim = OIM(config.openinfoman)
      const vims = VIMS(config.vims, '', config.timr, config.timrOauth2)
      res.end()
      updateTransaction(req, "Still Processing", "Processing", "200", "")
      req.timestamp = new Date()
      let orchestrations = []

      oim.getVimsFacilities(orchestrations, (err, facilities) => {
        vims.getFacilityWithLatestPeriod(facilities, (period) => {
          var firstDateNewMonth = moment(period.periodName, "MMM YYYY").startOf('month').add(1, 'month').format("YYYY-MM-DD")
          middleware.getStockONHAND(firstDateNewMonth, (rows) => {
            if(rows.length === 0) {
              winston.info("No Stock ON_HAND data found on TImR for period " + period.periodName)
              return
            }
            async.eachSeries(facilities, (facility, nxtFacility) => {
              winston.info("Sync Stock ON_HAND data for " + facility.facilityName)
              if(facility.periodId) {
                mixin.extractFacilityData(facility.timrFacilityId, rows, (facData) => {
                  if(facData.length > 0) {
                    vims.saveStockONHAND(facData, facility, orchestrations, () => {
                      winston.info("Done synchronizing Stock ON_HAND data" + " for " + facility.facilityName)
                      return nxtFacility()
                    })
                  } else {
                    winston.info("No data for " + facility.facilityName + " Skip processing Stock ON_HAND data")
                    return nxtFacility()
                  }
                })
              } else {
                winston.warn("No DRAFT Report for " + facility.facilityName + " Skip processing Stock ON_HAND data")
                return nxtFacility()
              }
            }, () => {
              winston.info("Done synchronizing Stock ON_HAND data")
            })
          })
        })
      })
    }),

    app.get('/syncStockAdjustments', (req, res) => {
      const oim = OIM(config.openinfoman)
      const vims = VIMS(config.vims, '', config.timr, config.timrOauth2)
      res.end()
      updateTransaction(req, "Still Processing", "Processing", "200", "")
      req.timestamp = new Date()
      let orchestrations = []

      oim.getVimsFacilities(orchestrations, (err, facilities) => {
        vims.getFacilityWithLatestPeriod(facilities, (period) => {
          var startDate = moment(period.periodName, "MMM YYYY").startOf('month').format("YYYY-MM-DD")
          var endDate = moment(period.periodName, "MMM YYYY").endOf('month').format('YYYY-MM-DD')
          middleware.getStockAdjustments(startDate, endDate, (rows) => {
            if(rows.length === 0) {
              winston.info("No Stock Adjustments data found on TImR for period " + period.periodName)
              return
            }
            async.eachSeries(facilities, (facility, nxtFacility) => {
              winston.info("Sync Stock Adjustments data for " + facility.facilityName)
              if(facility.periodId) {
                mixin.extractFacilityData(facility.timrFacilityId, rows, (facData) => {
                  if(facData.length > 0) {
                    vims.saveStockAdjustments(facData, facility, orchestrations, () => {
                      winston.info("Done synchronizing Stock Adjustments data" + " for " + facility.facilityName)
                      return nxtFacility()
                    })
                  } else {
                    winston.info("No data for " + facility.facilityName + " Skip processing Stock Adjustments data")
                    return nxtFacility()
                  }
                })
              } else {
                winston.warn("No DRAFT Report for " + facility.facilityName + " Skip processing Stock Adjustments data")
                return nxtFacility()
              }
            }, () => {
              winston.info("Done synchronizing Stock Adjustments data")
            })
          })
        })
      })
    }),

    app.get('/syncStock', (req, res) => {
      const oim = OIM(config.openinfoman)
      const vims = VIMS(config.vims)
      const timr = TImR(config.timr, config.oauth2, "", "", eventEmitter)
      req.timestamp = new Date()
      let orchestrations = []

      res.end()
      updateTransaction(req, "Still Processing", "Processing", "200", "")

      winston.info("Processing Stock Data")
      winston.info("Fetching Facilities")
      oim.getVimsFacilities(orchestrations, (err, facilities) => {
        winston.info("Done Fetching Facility Data")
        if (err) {
          winston.error("An Error Occured While Trying To Access OpenInfoMan,Stop Processing")
          return
        }
        async.eachSeries(facilities, function (facility, processNextFacility) {
          var vimsFacilityId = facility.vimsFacilityId
          var timrFacilityUUID = facility.timrFacilityUUID
          var timrFacilityId = facility.timrFacilityId
          var facilityName = facility.facilityName
          if (vimsFacilityId > 0) {
            winston.info("Getting period")
            vims.getPeriod(vimsFacilityId, orchestrations, (err, period) => {
              if (err) {
                winston.error(err)
                return processNextFacility()
              }
              if (period.length > 1) {
                winston.warn("VIMS has returned two DRAFT reports,processng stoped!!!")
                return processNextFacility()
              } else if (period.length == 0) {
                winston.warn("Skip Processing " + facilityName + ", No Period Found")
                return processNextFacility()
              } else {
                winston.info("Getting Access Token")
                if (period.length == 1) {
                  timr.getAccessToken('gs1', orchestrations, (err, res, body) => {
                    if (err) {
                      winston.error("An error occured while getting access token from TImR")
                      return processNextFacility()
                    }
                    winston.info("Received Access Token")
                    var access_token = JSON.parse(body).access_token
                    winston.info("Processing Stock For " + facilityName + ", Period " + period[0].periodName)
                    winston.info("Fetching TImR Stock Data For " + facilityName + ", Period " + period[0].periodName)
                    eventEmitter.once('received_timr_stock', function () {
                      processNextFacility()
                    })
                    timr.getStockData(access_token, timrFacilityUUID, period, orchestrations, (data) => {
                      winston.info("\tDone Fetching TImR Stock Data")
                      winston.info("\tExtracting TImR Stock Data")
                      timr.extractStockData(data, timrFacilityUUID, (timrStockData, stockCodes) => {
                        winston.info("\tDone Extracting TImR Stock Data")
                        if ((Object.keys(timrStockData).length == 0)) {
                          winston.warn("\tNo stock data to process for " + facilityName)
                          return
                        }
                        winston.info("\tSending Stock Data In VIMS " + JSON.stringify(timrStockData))
                        vims.getValueSets(vimsItemsValueSets, (err, vimsItemsValSet) => {
                          async.eachSeries(vimsItemsValSet, function (vimsItemsDataElmnt, processNextDtElmnt) {
                            winston.info("\tProcessing ProductID " + vimsItemsDataElmnt.code)
                            vims.saveStockData(period, timrStockData, stockCodes, vimsItemsDataElmnt.code, orchestrations, (res) => {
                              processNextDtElmnt()
                            })
                          }, function () {
                            winston.info("\tDone Processing " + facilityName)
                          })
                        })
                      })
                    })
                  })
                }
              }
            })
          }
        }, function () {
          winston.info('Done Synchronizing Stock Data!!!')
          //first update transaction without orchestrations
          updateTransaction(req, "", "Successful", "200", "")
          //update transaction with orchestration data
          updateTransaction(req, "", "Successful", "200", orchestrations)
          orchestrations = []
        })
      })
    }),

    app.get('/despatchAdviceIL', (req, res) => {
      /*loop through all districts
      Getting stock distribution from DVS (VIMS)
      */
      const oim = OIM(config.openinfoman)
      const vims = VIMS(config.vims, config.openinfoman)
      const timr = TImR(config.timr, config.oauth2)
      let orchestrations = []

      res.end()
      updateTransaction(req, "Still Processing", "Processing", "200", "")

      oim.getVimsFacilities(orchestrations, (err, facilities) => {
        if (err) {
          winston.error("An Error Occured While Trying To Access OpenInfoMan,Stop Processing")
          return
        }
        async.eachSeries(facilities, function (facility, processNextFacility) {
          var vimsFacilityId = facility.vimsFacilityId
          var facilityName = facility.facilityName
          vims.checkDistribution(vimsFacilityId, orchestrations, (err, distribution) => {
            if (err) {
              winston.error("An error occured while checking distribution for " + facilityName)
              return processNextFacility()
            }
            if (distribution == false || distribution == null || distribution == undefined) {
              winston.info("No Distribution For " + facilityName)
              return processNextFacility()
            } else {
              winston.info("Found distribution for " + facilityName)
            }
            winston.info("Now Converting Distribution To GS1")
            distribution = JSON.stringify(distribution)
            vims.convertDistributionToGS1(distribution, orchestrations, (err, despatchAdviceBaseMessage) => {
              if (err) {
                winston.error("An Error occured while trying to convert Distribution From VIMS,stop sending Distribution to TImR")
                return processNextFacility()
              }
              if (despatchAdviceBaseMessage == false || despatchAdviceBaseMessage == null || despatchAdviceBaseMessage == undefined) {
                winston.error("Failed to convert VIMS Distribution to GS1")
                return processNextFacility()
              }
              winston.info("Done Converting Distribution To GS1")
              winston.info("Getting GS1 Access Token From TImR")
              timr.getAccessToken('gs1', orchestrations, (err, res, body) => {
                winston.info("Received GS1 Access Token From TImR")
                if (err) {
                  winston.error("An error occured while getting access token from TImR")
                  return processNextFacility()
                }
                var access_token = JSON.parse(body).access_token
                winston.info("Saving Despatch Advice To TImR")
                timr.saveDistribution(despatchAdviceBaseMessage, access_token, orchestrations, (res) => {
                  if (res) {
                    winston.error("An error occured while saving despatch advice to TImR")
                    winston.error(distribution)
                    winston.error(despatchAdviceBaseMessage)
                    winston.error(res)
                    let msg = distribution + '<br><p>' + despatchAdviceBaseMessage
                    send_email.send("Stock Rejected By TImR", msg, () => {
                      return processNextFacility()
                    })
                  } else {
                    winston.info("Despatch Advice Saved To TImR Successfully")
                    return processNextFacility()
                  }
                })
              })
            })
          })
        }, function () {
          winston.info('Done Getting Despatch Advice!!!')
          //first update transaction without orchestrations
          updateTransaction(req, "", "Successful", "200", "")
          //update transaction with orchestration data
          updateTransaction(req, "", "Successful", "200", orchestrations)
          orchestrations = []
        })
      })
    }),

    app.get('/syncColdChain', (req, res) => {
      const oim = OIM(config.openinfoman)
      const vims = VIMS(config.vims, '', config.timr, config.timrOauth2)
      res.end()
      updateTransaction(req, "Still Processing", "Processing", "200", "")
      req.timestamp = new Date()
      let orchestrations = []

      oim.getVimsFacilities(orchestrations, (err, facilities) => {
        vims.getFacilityWithLatestPeriod(facilities, (period) => {
          let year_month = moment(period.periodName, "MMM YYYY").startOf('month').format("YYYY-MM")
          middleware.getColdChainData(year_month, (rows) => {
            if(rows.length === 0) {
              winston.info("No Cold Chain/Session data found on TImR for period " + period.periodName)
              return
            }
            async.eachSeries(facilities, (facility, nxtFacility) => {
              winston.info("Sync Cold Chain/Session data for " + facility.facilityName)
              if(facility.periodId) {
                mixin.extractFacilityData(facility.timrFacilityId, rows, (facData) => {
                  if(facData.length > 0) {
                    async.parallel({
                      coldChainSync: (callback) => {
                        vims.saveColdChain(facData, facility, orchestrations, () => {
                          winston.info("Done synchronizing Cold Chain data" + " for " + facility.facilityName)
                          return callback(false)
                        })
                      },
                      sessionSync: (callback) => {
                        vims.saveSessionsData(facData, facility, orchestrations, () => {
                          winston.info("Done synchronizing Session data" + " for " + facility.facilityName)
                          return callback(false)
                        })
                      }
                    }, () => {
                      return nxtFacility()
                    })
                  } else {
                    winston.info("No data for " + facility.facilityName + " Skip processing Cold Chain/Session data")
                    return nxtFacility()
                  }
                })
              } else {
                winston.warn("No DRAFT Report for " + facility.facilityName + " Skip processing Cold Chain/Session data")
                return nxtFacility()
              }
            }, () => {
              winston.info("Done synchronizing Cold Chain/Session data")
            })
          })
        })
      })
    }),

    app.get('/initializeReport', (req, res) => {
      const oim = OIM(config.openinfoman)
      const vims = VIMS(config.vims, config.openinfoman)
      res.end()
      updateTransaction(req, "Still Processing", "Processing", "200", "")

      let orchestrations = []
      oim.getVimsFacilities(orchestrations, (err, facilities) => {
        if (err) {
          winston.error("An Error Occured While Trying To Access OpenInfoMan,Stop Processing")
          return
        }
        async.eachSeries(facilities, function (facility, processNextFacility) {
          var vimsFacilityId = facility.vimsFacilityId
          var facilityName = facility.facilityName
          //var vimsFacilityId = 19630
          winston.info('Trying To Initilize Report For ' + facilityName)
          vims.getAllPeriods(vimsFacilityId, orchestrations, (err, body) => {
            if (err) {
              return processNextFacility()
            }
            var periods = []
            if (body.indexOf('error') == -1) {
              body = JSON.parse(body)
              if (body.hasOwnProperty("periods") && body.periods.length < 1)
                return processNextFacility()
              else if (!body.hasOwnProperty("periods"))
                return processNextFacility()
              body.periods.forEach((period, index) => {
                if (period.id == null && period.status == null) {
                  //lets initialize only one report on index 0
                  if (index == 0)
                    vims.initializeReport(vimsFacilityId, period.periodId, orchestrations, (err, body) => {
                      if (err) {
                        winston.error(err)
                      }
                      winston.info("Report for " + period.periodName + " Facility " + facilityName + " Initialized")
                    })
                }
                if (index == body.periods.length - 1) {
                  return processNextFacility()
                }
              })
            } else {
              return processNextFacility()
            }
          })
        }, function () {
          winston.info('Done Initilizing Reports To Facilities!!!')
          updateTransaction(req, "", "Successful", "200", orchestrations)
          orchestrations = []
        })
      })
    }),

    app.post('/despatchAdviceVims', (req, res) => {
      /*loop through all districts
      Getting stock distribution from DVS (VIMS)
      */
      res.end()
      updateTransaction(req, "Still Processing", "Processing", "200", "")
      winston.info("Received Despactch Advise From VIMS")
      const oim = OIM(config.openinfoman)
      const vims = VIMS(config.vims, config.openinfoman)
      const timr = TImR(config.timr, config.oauth2)
      let orchestrations = []

      var distribution = req.rawBody
      vims.convertDistributionToGS1(distribution, orchestrations, (err, despatchAdviceBaseMessage) => {
        if (err) {
          winston.error("An Error occured while trying to convert Distribution From VIMS,stop sending Distribution to TImR")
          updateTransaction(req, "", "Completed", "200", orchestrations)
          return
        }
        if (despatchAdviceBaseMessage == false) {
          winston.info("Failed to convert VIMS Distribution to GS1")
          updateTransaction(req, "", "Completed", "200", orchestrations)
          return
        }
        timr.getAccessToken('gs1', orchestrations, (err, res, body) => {
          if (err) {
            winston.error("An error occured while getting access token from TImR")
            updateTransaction(req, "", "Completed", "200", orchestrations)
            return
          }
          winston.info("Received GS1 Access Token From TImR")
          var access_token = JSON.parse(body).access_token
          winston.info("Saving Despatch Advice To TImR")
          timr.saveDistribution(despatchAdviceBaseMessage, access_token, orchestrations, (res) => {
            winston.info("Saved Despatch Advice To TImR")
            winston.info(res)
            updateTransaction(req, "", "Successful", "200", orchestrations)
            orchestrations = []
          })
        })
      })
    }),

    app.post('/receivingAdvice', (req, res) => {
      req.timestamp = new Date()
      let orchestrations = []
      const oim = OIM(config.openinfoman)
      const vims = VIMS(config.vims)
      //get the distribution

      res.end()
      updateTransaction(req, "Still Processing", "Processing", "200", "")
      winston.info("Received Receiving Advice From TImR")

      function getDistributionById(distributionId, orchestrations, callback) {
        vims.j_spring_security_check(orchestrations, (err, header) => {
          if (err) {
            return callback("", err)
          }
          var startDate = moment().startOf('month').format("YYYY-MM-DD")
          var endDate = moment().endOf('month').format("YYYY-MM-DD")
          var url = URI(config.vims.url).segment("vaccine/orderRequisition/sendNotification/" + distributionId)
          var options = {
            url: url.toString(),
            headers: {
              Cookie: header["set-cookie"]
            }
          }
          let before = new Date()
          request.get(options, (err, res, body) => {
            orchestrations.push(utils.buildOrchestration('Fetching Distribution', before, 'GET', options.url, JSON.stringify(options.headers), res, body))
            var distribution = JSON.parse(body).message
            if (distribution != null || distribution != "" || distribution != undefined) {
              return callback(distribution, err)
            } else {
              return callback("", err)
            }
          })
        })
      }

      function getDistributionByFacilityId(vimsToFacilityId, timr_distributionId, orchestrations, callback) {
        vims.j_spring_security_check(orchestrations, (err, header) => {
          if (err) {
            return callback("", err)
          }
          var startDate = moment().startOf('month').format("YYYY-MM-DD")
          var endDate = moment().endOf('month').format("YYYY-MM-DD")
          var url = URI(config.vims.url).segment("vaccine/inventory/distribution/distribution-supervisorid/" + vimsToFacilityId)
          var options = {
            url: url.toString(),
            headers: {
              Cookie: header["set-cookie"]
            }
          }
          let before = new Date()
          request.get(options, (err, res, body) => {
            orchestrations.push(utils.buildOrchestration('Fetching Distribution', before, 'GET', options.url, JSON.stringify(options.headers), res, body))
            if (isJSON(body)) {
              var distribution = JSON.parse(body).distribution
            } else {
              var distribution = null
            }
            if (distribution != null && distribution != "" && distribution != undefined) {
              //in case we dont get the distribution id we expected then try fetching distr by id
              if (timr_distributionId != distribution.id) {
                winston.info("VIMS Distribution ID " + distribution.id + " Mismatch distribution ID " + timr_distributionId + ",that we are looking,trying fetching by distribution ID")
                getDistributionById(timr_distributionId, orchestrations, (distribution, err) => {
                  return callback(distribution, err)
                })
              } else
                return callback(distribution, err)
            } else {
              //in case we dont get any distribution then may be lets try fetching distr by id
              winston.info("No distribution received from VIMS,try fetching by distribution ID")
              getDistributionById(timr_distributionId, orchestrations, (distribution, err) => {
                return callback(distribution, err)
              })
            }
          })
        })
      }

      var distr = req.rawBody
      if (distr == "" || distr == null || distr == undefined) {
        winston.warn("TImR has sent empty receiving Advice,stop processing")
        return updateTransaction(req, "TImR has sent empty receiving Advice", "Completed", "200", "")
      }

      var ast = XmlReader.parseSync(distr)
      var distributionid = xmlQuery(ast).find("receivingAdvice").children().
      find("despatchAdvice").children().
      find("entityIdentification").text()
      var shiptoLength = xmlQuery(ast).find("receivingAdvice").children().find("shipTo").children().size()
      var shipto = xmlQuery(ast).find("receivingAdvice").children().find("shipTo").children()
      var toFacilityId = ""
      for (var counter = 0; counter < shiptoLength; counter++) {
        if (shipto.eq(counter).attr("additionalPartyIdentificationTypeCode") == "HIE_FRID")
          toFacilityId = shipto.eq(counter).find("additionalPartyIdentification").text()
      }

      if (toFacilityId == "" || toFacilityId == null || toFacilityId == undefined) {
        winston.error("Empty Destination Facility found in TImR Receiving Advice,stop processing")
        return updateTransaction(req, "Empty Destination Facility found in TImR Receiving Advice", "Completed", "200", "")
      }

      var shipfromLength = xmlQuery(ast).find("receivingAdvice").children().find("shipper").children().size()
      var shipfrom = xmlQuery(ast).find("receivingAdvice").children().find("shipper").children()
      var fromFacilityId = ""
      for (var counter = 0; counter < shipfromLength; counter++) {
        if (shipfrom.eq(counter).attr("additionalPartyIdentificationTypeCode") == "HIE_FRID")
          fromFacilityId = shipfrom.eq(counter).find("additionalPartyIdentification").text()
      }

      if (fromFacilityId == "" || fromFacilityId == null || fromFacilityId == undefined) {
        winston.error("Empty Source Facility found in TImR Receiving Advice,stop processing")
        return updateTransaction(req, "Empty Source Facility found in TImR Receiving Advice", "Completed", "200", "")
      }

      var vimsToFacilityId = null
      winston.info("Getting VIMS facility ID")
      oim.getVimsFacilityId(toFacilityId, orchestrations, (err, vimsFacId) => {
        if (err) {
          winston.error("An Error Occured While Trying To Access OpenInfoMan,Stop Processing")
          return
        }
        if (vimsFacId == "" || vimsFacId == null || vimsFacId == undefined) {
          winston.error("No matching VIMS Facility ID for " + toFacilityId + ",Stop Processing")
          return updateTransaction(req, "No matching VIMS Facility ID for " + toFacilityId, "Completed", "200", "")
        }
        winston.info("Received VIMS facility ID")
        vimsToFacilityId = vimsFacId
        winston.info("Getting Distribution From VIMS For Receiving Advice")
        if (vimsToFacilityId)
          getDistributionByFacilityId(vimsToFacilityId, distributionid, orchestrations, (distribution, err) => {
            winston.info("Received Distribution From VIMS For Receiving Advice")
            if (!distribution) {
              winston.warn('No matching DespatchAdvice in VIMS!!!')
              updateTransaction(req, "No matching DespatchAdvice in VIMS!!!", "Completed", "200", orchestrations)
            }
            if (distribution) {
              if (distributionid == distribution.id) {
                distribution.status = "RECEIVED"
                async.eachSeries(distribution.lineItems, function (lineItems, nextlineItems) {
                  var lineItemQuantity = 0
                  async.eachSeries(lineItems.lots, function (lot, nextLot) {
                    var lotId = lot.lotId
                    var lotQuantity = lot.quantity

                    //find quantity accepted for this lot
                    var productsLength = xmlQuery(ast).find("receivingAdvice").children().find("receivingAdviceLogisticUnit").children().size()
                    var products = xmlQuery(ast).find("receivingAdvice").children().find("receivingAdviceLogisticUnit").children()
                    var quantityAcc = 0
                    for (var counter = 0; counter < productsLength; counter++) {
                      if (products.eq(counter).find("receivingAdviceLineItem").children().find("transactionalTradeItem").children().find("additionalTradeItemIdentification").attr("additionalTradeItemIdentificationTypeCode") == "VIMS_STOCK_ID" && products.eq(counter).find("receivingAdviceLineItem").children().find("transactionalTradeItem").children().find("additionalTradeItemIdentification").text() == lotId)
                        quantityAcc = products.eq(counter).find("receivingAdviceLineItem").children().find("quantityAccepted").text()
                    }
                    //set this lot to quantity Accepted
                    lot.quantity = Number(quantityAcc)

                    lineItemQuantity = Number(lineItemQuantity) + Number(quantityAcc)
                    nextLot()
                  }, function () {
                    lineItems.quantity = lineItemQuantity
                    nextlineItems()
                  })
                }, function () {
                  //submit Receiving Advice To VIMS
                  winston.info("Sending Receiving Advice To VIMS")
                  vims.sendReceivingAdvice(distribution, orchestrations, (res) => {
                    winston.info(res)
                    winston.info('Receiving Advice Submitted To VIMS!!!')
                    updateTransaction(req, "", "Successful", "200", orchestrations)
                    orchestrations = []
                  })
                })
              } else {
                winston.error("VIMS has responded with Despatch Advice ID " + distribution.id + " Which Does Not Match TImR Receiving Advice ID " + distributionid)
                return updateTransaction(req, "VIMS has responded with Despatch Advice ID " + distribution.id + " Which Does Not Match TImR Receiving Advice ID " + distributionid, "Completed", "200", orchestrations)
                orchestrations = []
              }
            }
          })
      })
    }),

    app.post('/orderRequest', (req, res) => {
      res.end()
    })

  app.get('/remindDefaulters', (req, res) => {
    res.end()
    updateTransaction(req, "Still Processing", "Processing", "200", "")
    let orchestrations = []
    const timr = TImR(config.timr, config.oauth2)
    const smsAggregator = SMSAGGREGATOR(config.smsAggregator)

    function getVaccDiseaseMapping(vacc, callback) {
      var diseases = []
      var vacc_arr = vacc.split(",")
      async.eachSeries(vacc_arr, (vacc, nxtVacc) => {
        async.eachOfSeries(vacc_diseases_mapping, (vacc_diseases, vacc_diseases_key, nxtVaccDiseases) => {
          if (vacc_diseases_key == vacc && vacc_diseases != "") {
            if (vacc_diseases.length) {
              async.eachSeries(vacc_diseases, (dis, nxt) => {
                diseases.push(dis)
                nxt()
              }, function () {
                return nxtVaccDiseases()
              })
            } else {
              diseases.push(vacc_diseases)
              return nxtVaccDiseases()
            }
          } else {
            return nxtVaccDiseases()
          }
        }, function () {
          return nxtVacc()
        })
      }, function () {
        var last_vacc = false
        if (diseases.length > 1)
          last_vacc = diseases.pop()
        var diseases_string = diseases.join(",")
        if (last_vacc)
          diseases_string = diseases_string + " & " + last_vacc
        return callback(diseases_string)
      })
    }

    var spinner = new Spinner("Waiting for timr access token")
    spinner.setSpinnerString(8);
    spinner.start()
    timr.getAccessToken('fhir', orchestrations, (err, res, body) => {
      spinner.stop()
      if (err) {
        winston.error("An error occured while getting access token from TImR")
        updateTransaction(req, "", "Completed", "200", orchestrations)
        return
      }
      winston.info("Received Access Token From TImR")
      var access_token = JSON.parse(body).access_token
      timr.getDefaulters(access_token, orchestrations, (defaulters, err) => {
        if (err) {
          winston.warn("An error occured while getting defaulters")
          return updateTransaction(req, "", "Completed", "200", orchestrations)
        }
        if (!isJSON(defaulters)) {
          winston.warn("Non JSON defaulter's list have been received")
          return updateTransaction(req, "", "Completed", "200", orchestrations)
        }

        var defaulters = defaulters.replace(/\s/g, '')
        var defaulters = JSON.parse(defaulters).item
        const promises = []
        var child_tel
        var mth_tel
        var nok_tel
        var missed_doses
        var days
        for (var def_id in defaulters) {
          promises.push(new Promise((resolve, reject) => {
            async.eachSeries(defaulters[def_id].p, (defDet, nxtDefDet) => {
              if (defDet.Name == "days_overdue")
                days = defDet.Value
              if (defDet.Name == "missed_doses")
                missed_doses = defDet.Value
              if (defDet.Name == "tel")
                child_tel = defDet.Value
              if (defDet.Name == "mth_tel")
                mth_tel = defDet.Value
              if (defDet.Name == "nok_tel")
                nok_tel = defDet.Value
              return nxtDefDet()
            }, function () {
              var phone = null
              if (child_tel != null)
                phone = child_tel
              else if (mth_tel != null)
                phone = mth_tel
              else if (nok_tel != null)
                phone = nok_tel

              if (phone == null) {
                resolve()
              } else {
                if (phone.indexOf("0") === 0) {
                  phone = phone.replace("0", "255")
                } else if (phone.indexOf("0") !== 0 && phone.indexOf("255") !== 0 && phone.indexOf("+255") !== 0) {
                  if (phone.length == 9)
                    phone = "255" + phone
                }

                getVaccDiseaseMapping(missed_doses, (diseases) => {
                  var day_name = moment().format("dddd")
                  if (day_name == "Saturday" || day_name == "Sunday")
                    var day = "JUMATATU"
                  else
                    var day = "LEO"

                  var msg = "MTOTO WAKO HAKUPATA CHANJO YA " + missed_doses +
                    ".INAYOKINGA DHIDI YA MAGONJWA YA " + diseases + ".TAFADHALI HUDHURIA KITUO CHA CHANJO CHA KARIBU KWA AJILI YA CHANJO NA USHAURI ZAIDI"
                  smsAggregator.broadcast(phone, msg, orchestrations)
                  resolve()
                })
              }
            })
          }))
        }

        Promise.all(promises).then(() => {
          winston.info("Done alerting defaulters")
          updateTransaction(req, "", "Successful", "200", orchestrations)
        })


      })
    })
  })

  return app
}

/**
 * start - starts the mediator
 *
 * @param  {Function} callback a node style callback that is called once the
 * server is started
 */
function start(callback) {
  if (apiConf.register) {
    medUtils.registerMediator(apiConf.api, mediatorConfig, (err) => {
      if (err) {
        winston.error('Failed to register this mediator, check your config')
        winston.error(err.stack)
        process.exit(1)
      }
      apiConf.api.urn = mediatorConfig.urn
      medUtils.fetchConfig(apiConf.api, (err, newConfig) => {
        winston.info('Received initial config:', newConfig)
        config = newConfig
        if (err) {
          winston.info('Failed to fetch initial config')
          winston.info(err.stack)
          process.exit(1)
        } else {
          winston.info('Successfully registered mediator!')
          let app = setupApp()
          const server = app.listen(port, () => {
            let configEmitter = medUtils.activateHeartbeat(apiConf.api)
            configEmitter.on('error', (error) => {
              winston.error(error)
              winston.error("an error occured while trying to activate heartbeat")
            })
            configEmitter.on('config', (newConfig) => {
              winston.info('Received updated config:', newConfig)
              // set new config for mediator
              config = newConfig
            })
            callback(server)
          })
        }
      })
    })
  } else {
    // default to config from mediator registration
    config = mediatorConfig.config
    let app = setupApp()
    const server = app.listen(port, () => callback(server))
  }
}
exports.start = start

if (!module.parent) {
  // if this script is run directly, start the server
  start(() => winston.info('Listening on ' + port + '...'))
}