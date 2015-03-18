'use strict';

var debug = require('debug')(__filename.slice(__dirname.length + 1));
var fs = require('fs');
var util = require('./crater-util');
var tc = require('taskcluster-client');
var Promise = require('promise');
var slugid = require('slugid');
var scheduler = require('./scheduler');
var crateIndex = require('./crate-index');

function main() {
  var options = parseOptionsFromArgs();
  if (!options) {
    console.log("can't parse options");
    process.exit(1);
  }

  debug("scheduling for toolchain %s", JSON.stringify(options));

  var config = util.loadDefaultConfig();

  crateIndex.cloneIndex(config).then(function() {
    return scheduler.createSchedule(options, config);
  }).then(function(schedule) {
    return scheduler.scheduleBuilds(schedule, config);
  }).then(function(tasks) {
    console.log("created " + tasks.length + " tasks");
  }).done();
}

function parseOptionsFromArgs() {
  var toolchain = util.parseToolchain(process.argv[2])
  var top = null;
  for (var i = 3; i < process.argv.length; i++) {
    if (process.argv[i] == "--top") {
      top = parseInt(process.argv[i + 1]);
    }
  }

  return {
    toolchain: toolchain,
    top: top
  };
}

main();
