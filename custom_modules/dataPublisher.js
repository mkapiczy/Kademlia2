const constants = require("./../config/constants");
const util = require("./util");
const communicator = require("./communicator");
const async = require("async");

function DataPublisher() {}

DataPublisher.prototype.publishToKNodesClosestToTheKey = function(key, value) {
  var shortlist = [];
  var hashedKey = util.createHashFromKey(key, constants.B / 8);
  console.log("Publish key: " + hashedKey);
  var alphaNodes = global.BucketManager.getAlphaClosestNodes(hashedKey);
  if (alphaNodes.length === 0) return;
  sendAsyncFindNodes(alphaNodes, hashedKey, shortlist, null, resultShortlist => {
    sendStoreValueToAllNodesInTheShortlist(resultShortlist, hashedKey, value);
  });
};

DataPublisher.prototype.findValue = function(key, callback) {
  var shortlist = [];
  var alphaNodes = global.BucketManager.getAlphaClosestNodes(key);

  sendAsyncFindNodes(alphaNodes, key, shortlist, null, resultShortlist => {
    var iterator = 0;
    var value = askNodeForAValue(resultShortlist, iterator, key, callback);
  });
};

askNodeForAValue = function(shortlist, iterator, key, callback) {
  nodeToAsk = shortlist[iterator];
  communicator.sendFindValue(nodeToAsk, key, value => {
    if (value) {
      callback(nodeToAsk.id, value);
    } else {
      if (iterator < shortlist.length - 1) {
        iterator++;
        askNodeForAValue(shortlist, iterator, key, callback);
      } else {
        console.log("All nodes asked and no value found!");
        callback(null, null);
      }
    }
  });
};

sendAsyncFindNodes = function(alphaNodes, hashedKey, shortlist, currentClosestNode, callback) {
  if(!currentClosestNode){
    currentClosestNode = alphaNodes[0];
  }
  asyncCallsArray = prepareAsyncCalls(alphaNodes, hashedKey);

  async.parallel(asyncCallsArray, function(err, results) {
    if (err) {
      console.log("An error occured during async call: ", err);
    }

    results = mergeAsyncCallsResultsIntoOneArray(results);
    shortlist = updateShortlistAfterAsyncCalls(shortlist, alphaNodes, results);

    if (updateClosestNode(shortlist, currentClosestNode, hashedKey)) {
      nextCallAlphaNodes = getNextCallAlphaNodesFromShortlist(shortlist);
      sendAsyncFindNodes(nextCallAlphaNodes, hashedKey, shortlist, currentClosestNode, callback);
    } else {
      shortlist = removeGlobalNodeFromShortlist(shortlist);
      shortlist = shortlist.slice(0, constants.k);
      callback(shortlist);
    }
  });
};

prepareAsyncCalls = function(alphaNodes, hashedKey) {
  asyncCallsArray = [];
  alphaNodes.forEach(node => {
    asyncCallsArray.push(function(callback) {
      communicator.sendGetClosestNodesRequest(hashedKey, node, function(
        result
      ) {
        callback(null, result);
      });
    });
  });
  return asyncCallsArray;
};

mergeAsyncCallsResultsIntoOneArray = function(unMergedResults) {
  var mergedResults = [];
  unMergedResults.forEach(result => {
    mergedResults = mergedResults.concat(result);
  });
  return mergedResults;
};

updateShortlistAfterAsyncCalls = function(shortlist, alphaNodes, results) {
  shortlist = addIfUniqueToShortlist(shortlist, alphaNodes, true);
  shortlist = addIfUniqueToShortlist(shortlist, results, false);
  return shortlist;
};

updateClosestNode = function(shortlist, currentClosestNode, hashedKey) {
  shortlist = global.BucketManager.sortNodesListByDistanceAscending(
    hashedKey,
    shortlist
  );
  newClosestNode = shortlist[0];

  if (newClosestNode.id !== currentClosestNode.id) {
    console.log("New closest node!");
    currentClosestNode = newClosestNode;
    return true;
  }

  return false;
};

getNextCallAlphaNodesFromShortlist = function(shortlist) {
  nextCallAlphaNodes = [];
  shortlist.forEach(node => {
    if (
      node.isContacted === false &&
      nextCallAlphaNodes.length < constants.alpha
    ) {
      nextCallAlphaNodes.push(node);
    }
  });
  return nextCallAlphaNodes;
};

removeGlobalNodeFromShortlist = function(shortlist) {
  shortlist = shortlist.filter(nd => {
    return nd.id !== global.node.id;
  });
  return shortlist;
};

sendStoreValueToAllNodesInTheShortlist = function(shortlist, hashedKey, value) {
  shortlist.forEach(node => {
    communicator.sendStoreValue(node, hashedKey, value, result => {
      console.log("Send store value result in data manager: " + result);
    });
  });
};

selectAlphaClosestNodes = function(closestNodes, hashedKey) {
  closestNodes = global.BucketManager.sortNodesListByDistanceAscending(
    hashedKey,
    closestNodes
  );
  return closestNodes.slice(0, constants.alpha);
};

selectClosestNode = function(nodes, hashedKey) {
  var closestNode = nodes[0];
  for (var i = 1; i < nodes.length; i++) {
    if ((nodes[i] ^ hashedKey) < (closestNode ^ hashedKey)) {
      closestNode = nodes[i];
    }
  }
  return closestNode;
};

removeNodeDuplicates = function(keyFn, array) {
  var mySet = new Set();
  return array.filter(function(x) {
    var key = keyFn(x),
      isNew = !mySet.has(key);
    if (isNew) mySet.add(key);
    return isNew;
  });
};

addIfUniqueToShortlist = function(shortlist, nodes, isContacted) {
  nodes.forEach(node => {
    var isInShortList = false;

    shortlist.forEach(item => {
      if (item.id === node.id) {
        isInShortList = true;
      }
    });

    if (!isInShortList) {
      node["isContacted"] = isContacted;
      shortlist.push(node);
    }
  });
  return shortlist;
};

module.exports = DataPublisher;