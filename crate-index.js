'use strict';

var debug = require('debug')(__filename.slice(__dirname.length + 1));
var Promise = require('promise');
var _fs = require('graceful-fs'); // Need to parse many files at once
var fs = {
  existsSync: _fs.existsSync,
  readFile: Promise.denodeify(_fs.readFile),
  writeFile: Promise.denodeify(_fs.writeFile),
};
var walk = require('walkdir');
var path = require('path');
var semver = require('semver');
var util = require('./crater-util');

var defaultIndexAddr = "https://github.com/rust-lang/crates.io-index"
var defaultCacheDir = "./cache"

var localIndexName = "crate-index"
var crateCacheName = "crate-cache"
var sourceCacheName = "source-cache"
var versionCacheName = "version-cache"

/**
 * Ensure that the crate-index repository is either present or created
 */
function cloneIndex(indexAddr, cacheDir) {
  indexAddr = indexAddr || defaultIndexAddr;
  cacheDir = cacheDir || defaultCacheDir;

  var localIndex = path.join(cacheDir, localIndexName);

  var p; 
  if (fs.existsSync(localIndex)) {
    p = util.runCmd('git pull origin master', {cwd: localIndex});
  } else {
    p = util.runCmd('mkdir -p ' + localIndex);
    p = util.runCmd('git clone ' + indexAddr + ' ' + localIndex);
  }

  p = p.then(function(x) {
    debug('Repository exists');
  });

  return p
}

/**
 * Find all files in the repository which are not git files.
 */
function findFiles(directory) {
  return new Promise(function(resolve, reject) {
    var filesFound = [];
    var dir = path.resolve(directory); 
    var dirLength = dir.length + 1; // Avoid the unnecessary .
    var emitter = walk(directory); 

    // Store files
    emitter.on('file', function(_filename, stat) {
      var filename = path.resolve(_filename);
      filename = filename.slice(dirLength);
      // Ignore gitfiles and top level files (e.g. config.json)
      if (!/^[.]git\//.test(filename) && filename.indexOf(path.sep) !== -1) {
        filesFound.push(filename); 
      }
    });

    // Handle errors
    emitter.on('error', function(err) {
      reject(err);
    });

    // Fails are found files which could not be stat'd
    emitter.on('fail', function(fail) {
      debug('Failed to read a file! %s', fail);
    });

    // Resolve when all files are read
    emitter.on('end', function() {
      resolve(filesFound);
    });
  });
};

/**
 * Read all versions of a given descriptor file and parse them into
 * JSON
 */
function readFile(dir, filename) {
  return fs.readFile(path.join(dir, filename), 'utf-8').then(function(filedata) {
    var files = filedata.split('\n');
    return files.filter(function(f) { return !!f }).map(function(f) {
      return JSON.parse(f);
    });
  });
}


/**
 * Load the crate index from the remote address.
 */
function loadCrates(indexAddr, cacheDir) {
  indexAddr = indexAddr || defaultIndexAddr;
  cacheDir = cacheDir || defaultCacheDir;

  var localIndex = path.join(cacheDir, localIndexName);

  var p = cloneIndex(indexAddr, cacheDir);

  p = p.then(function() {
    debug('repos asserted');
    return findFiles(localIndex)
  });

  p = p.then(function(filenames) {
    debug('files found');
    return Promise.all(filenames.map(function(filename) {
      return readFile(localIndex, filename);
    }));
  });

  p = p.then(function(res) {
    debug('files read');
    var flat = [];
    res.forEach(function(r) {
      Array.prototype.push.apply(flat, r);
    });
    return flat;
  });

  return p;
}

/**
 * Gets the 'dl' field from config.json in the index.
 */
function getDlRootAddrFromIndex(cacheDir) {
  cacheDir = cacheDir || defaultCacheDir;

  var localIndex = path.join(cacheDir, localIndexName);

  return fs.readFile(path.join(localIndex, "config.json"), 'utf-8').then(function(filedata) {
    return JSON.parse(filedata);
  }).then(function(data) {
    return data.dl;
  });
}

/**
 * Downloads the version metadata from crates.io and returns it.
 */
function getVersionMetadata(crateName, crateVers, dlRootAddr, cacheDir) {
  cacheDir = cacheDir || defaultCacheDir;

  var versionCache = path.join(cacheDir, versionCacheName);

  var url = dlRootAddr + "/" + crateName + "/" + crateVers;
  var cacheDir = versionCache + "/" + crateName;
  var cacheFile = cacheDir + "/" + crateVers;

  if (fs.existsSync(cacheFile)) {
    debug("using cache for metadata " + crateName + " " + crateVers);
    return fs.readFile(cacheFile, 'utf-8').then(function(filedata) {
      return JSON.parse(filedata);
    });
  } else {
    debug("downloading metadata " + crateName + " " + crateVers);
    var json = null;
    var p = util.downloadToMem(url);
    p = p.then(function(data) {
      json = JSON.parse(data);
    });
    p = p.then(function() {
      return util.runCmd('mkdir -p ' + cacheDir);
    });
    p = p.then(function() {
      return fs.writeFile(cacheFile, JSON.stringify(json));
    });
    p = p.then(function() { return json; });
    return p;
  }
}

function getCrateFile(crateName, crateVers, dlRootAddr, cacheDir) {
  cacheDir = cacheDir || defaultCacheDir;
  assert(false); // TODO
}

function getCrateSource(crateName, crateVers, dlRootAddr, cacheDir) {
  cacheDir = cacheDir || defaultCacheDir;
  assert(false); // TODO
}

/**
 * Given the resolved output from `loadCrates`, return a map from crate
 * names to arrays of crate data.
 */
function getMostRecentRevs(crates) {
  var map = {};
  crates.forEach(function(c) {
    if (map[c.name] == null) {
      map[c.name] = c;
    } else {
      if (semver.lt(map[c.name].vers, c.vers)) {
	map[c.name] = c;
      }
    }
  });

  return map;
}

/**
 * Given the resolved output from `loadCrates`, return a map from crate
 * names to arrays of dependencies, using data from the most recent crate revisions
 * (so it is not perfectly accurate).
 */
function getDag(crates) {
  var mostRecent = getMostRecentRevs(crates);
  var map = { };
  crates.forEach(function(crate) {
    var deps = [];
    crate.deps.forEach(function(dep) {
      deps.push(dep.name);
    });
    map[crate.name] = deps;
  });
  return map;
}

exports.defaultIndexAddr = defaultIndexAddr;
exports.defaultCacheDir = defaultCacheDir;
exports.cloneIndex = cloneIndex;
exports.loadCrates = loadCrates;
exports.getDlRootAddrFromIndex = getDlRootAddrFromIndex;
exports.getCrateFile = getCrateFile;
exports.getCrateSource = getCrateSource;
exports.getVersionMetadata = getVersionMetadata;
exports.getMostRecentRevs = getMostRecentRevs;
exports.getDag = getDag;
