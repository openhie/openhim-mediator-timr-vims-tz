require('./init');
const cluster = require('cluster');
const express = require('express');
const bodyParser = require('body-parser');
const { Pool } = require('pg')
const formidable = require('formidable');
const cors = require('cors');
const async = require('async')
const winston = require('winston');
const config = require('./config');

const app = express();
const server = require('http').createServer(app);

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

app.use(cors({
  origin: true,
  credentials: true
}));

app.use(bodyParser.urlencoded({
  extended: true,
}));
app.use(bodyParser.json());


app.get('/test', (req, res) => {
  centralPool.query("select ent_id, id_val, nsid from ent_id_tbl inner join asgn_aut_tbl using (aut_id) where oid = '1.3.6.1.4.1.45129.3.1.5.102.901'", (err, response) => {
    async.each(response.rows, (row) => {
      console.log("Processing " + row.ent_id)
      let query = `insert into fac_id_tbl (fac_id, hfr_id, nsid) values ('${row.ent_id}', '${row.id_val}', '${row.nsid}')`
      console.log(query)
      warehousePool.query(query)
    })
  })
})
server.listen(config.getConf('server:port'));
winston.info(`Server is running and listening on port ${config.getConf('server:port')}`);