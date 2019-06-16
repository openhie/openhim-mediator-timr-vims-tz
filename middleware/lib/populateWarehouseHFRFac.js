require('./init');
const express = require('express');
const bodyParser = require('body-parser');
const { Pool } = require('pg')
const cors = require('cors');
const async = require('async')
const winston = require('winston');
const config = require('./config');

const centralPool = new Pool({
  user: 'dwhmiddle',
  host: 'timr.ctdiocjoaayg.us-west-2.rds.amazonaws.com',
  database: 'timrdb',
  password: '$bidtz2019',
  port: 5432,
})

const warehousePool = new Pool({
  user: 'middleware',
  host: 'timrdwh.ctdiocjoaayg.us-west-2.rds.amazonaws.com',
  database: 'timrdwh',
  password: '$MiddlE@tz19??',
  port: 5432,
})

const localPool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'timrdwh_latest',
  password: 'tajiri',
  port: 5432,
})

// need to create this fac_id_tbl with below queries
// CREATE TABLE fac_id_tbl (
//   fac_id UUID NOT NULL,
//   hfr_id VARCHAR(64) NOT NULL,
//   nsid VARCHAR(64),
//   CONSTRAINT pk_hfr_id_tbl PRIMARY KEY (fac_id, nsid)
// );

centralPool.query("select ent_id, id_val, nsid from ent_id_tbl inner join asgn_aut_tbl using (aut_id) where oid = '1.3.6.1.4.1.45129.3.1.5.102.901'", (err, response) => {
  if(err) {
    console.error(err)
  }
  async.each(response.rows, (row) => {
    console.log("Processing " + row.ent_id)
    let query = `insert into fac_id_tbl (fac_id, hfr_id, nsid) values ('${row.ent_id}', '${row.id_val}', '${row.nsid}')`
    console.log(query)
    localPool.query(query)
  })
})