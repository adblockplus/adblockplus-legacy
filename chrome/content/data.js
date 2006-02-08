/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Adblock Plus.
 *
 * The Initial Developer of the Original Code is
 * Wladimir Palant.
 * Portions created by the Initial Developer are Copyright (C) 2006
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * ***** END LICENSE BLOCK ***** */

/*
 * Stores Adblock Plus data to be attached to a window.
 * This file is included from nsAdblockPlus.js.
 */

var queryResult;

function DataContainer(insecWnd) {
  this.locations = {};
  this.subdocs = [];
  this.install(insecWnd);
}
abp.DataContainer = DataContainer;

DataContainer.prototype = {
  topContainer: null,
  insecWnd: null,

  // Attaches the data to a window
  install: function(insecWnd) {
    var insecTop = secureGet(insecWnd, "top");
    if (insecTop != insecWnd) {
      this.topContainer = DataContainer.getDataForWindow(insecTop);
      this.topContainer.registerSubdocument(this);
      if (policy.isBlockableScheme(secureGet(insecWnd, "location"))) {
        var location = secureGet(insecWnd, "location", "href");
        this.addNode(insecTop, insecWnd, type.SUBDOCUMENT, location, policy.isWhitelisted(location));
      }
    }
    else
      this.topContainer = this;

    this.installListeners(secureLookup(insecWnd, "addEventListener"));
  },

  installListeners: function(addListener) {
    var me = this;
    var queryHandler = function(ev) {
      if (ev.isTrusted && ev.eventPhase == ev.AT_TARGET)
        queryResult = me;
    }
    addListener("abpQuery", queryHandler, true);

    var hideHandler = function(ev) {
      // unload events aren't trusted in 1.7.5, need to find out when this was fixed
      if ((!ev.isTrusted && ev.type != "unload") || ev.eventPhase != ev.AT_TARGET)
        return;

      if (me != me.topContainer)
        me.topContainer.unregisterSubdocument(me);

      DataContainer.notifyListeners(secureGet(this, "top"), me == me.topContainer ? "clear" : "refresh", me.topContainer);

      if (secureGet(this, "location", "href") == "about:blank") {
        // Make sure to re-add the frame - we are not really going away
        var insecWnd = this;
        createTimer(function() {
          var insecTop = secureGet(this, "top");
          if (policy.isBlockableScheme(secureGet(insecWnd, "location"))) {
            var data = DataContainer.getDataForWindow(insecWnd);
            var location = secureGet(insecWnd, "location", "href");
            data.addNode(insecTop, insecWnd, type.SUBDOCUMENT, location, policy.isWhitelisted(location));
          }
        }, 0);
      }
    }

    if ("nsIDOMPageTransitionEvent" in Components.interfaces) {
      // This is Gecko 1.8 - use pagehide/pageshow events
      var showHandler = function(ev) {
        if (!ev.isTrusted || ev.eventPhase != ev.AT_TARGET)
          return;

        if (me != me.topContainer)
          me.topContainer.registerSubdocument(me);

        DataContainer.notifyListeners(secureGet(this, "top"), "select", me.topContainer);
      }
      addListener("pagehide", hideHandler, false);
      addListener("pageshow", showHandler, false);
    }
    else {
      // This is Gecko 1.7 - fall back to unload
      addListener("unload", hideHandler, false);
    }

    addListener = null;
  },

  registerSubdocument: function(data) {
    this.subdocs.push(data);
  },
  unregisterSubdocument: function(data) {
    for (var i = 0; i < this.subdocs.length; i++)
      if (this.subdocs[i] == data)
        this.subdocs.splice(i--, 1);
  },
  addNode: function(insecTop, insecNode, contentType, location, filter) {
    // for images repeated on page store node for each repeated image
    var key = " " + location;
    if (key in this.locations) {
      // Always override the filter just in case a known node has been blocked
      this.locations[key].filter = filter;

      // Do not add the same node twice
      for (var i = 0; i < this.locations[key].inseclNodes.length; i++)
        if (this.locations[key].inseclNodes[i] == insecNode)
          return;

      this.locations[key].inseclNodes.push(insecNode);
    }
    else {
      // Add a new location and notify the listeners
      this.locations[key] = {
        inseclNodes: [insecNode],
        location: location,
        type: contentType,
        typeDescr: typeDescr[contentType],
        localizedDescr: localizedDescr[contentType],
        filter: filter
      };
      DataContainer.notifyListeners(insecTop, "add", this.topContainer, this.locations[key]);
    }
  },
  getLocation: function(location) {
    var key = " " + location;
    if (key in this.locations)
      return this.locations[key];

    for (var i = 0; i < this.subdocs.length; i++) {
      var result = this.subdocs[i].getLocation(location);
      if (result)
        return result;
    }

    return null;
  },
  getAllLocations: function(results) {
    if (typeof results == "undefined")
      results = [];
    for (var key in this.locations)
      if (key.match(/^ /))
          results.push(this.locations[key]);

    for (var i = 0; i < this.subdocs.length; i++)
      this.subdocs[i].getAllLocations(results);

    return results;
  }
};

// Loads Adblock data associated with a window object
var insecLastQuery = null;
var lastQueryResult = null;
DataContainer.getDataForWindow = function(insecWnd) {
  var insecDoc = secureGet(insecWnd, "document");
  if (insecLastQuery == insecDoc)
    return lastQueryResult;

  queryResult = null;
  var ev = secureLookup(insecDoc, "createEvent")("Events");
  ev.initEvent("abpQuery", false, false);
  secureLookup(insecWnd, "dispatchEvent")(ev);

  var data = queryResult;
  if (!data)
    data = new DataContainer(insecWnd);

  insecLastQuery = insecDoc;
  lastQueryResult = data;

  return data;
};
abp.getDataForWindow = DataContainer.getDataForWindow;

// Loads Adblock data associated with a node object
DataContainer.getDataForNode = function(insecNode) {
  var insecWnd = getTopWindow(insecNode);
  if (!insecWnd)
    return null;

  var data = DataContainer.getDataForWindow(insecWnd).getAllLocations();
  while (insecNode) {
    for (var i = 0; i < data.length; i++)
      for (var j = 0; j < data[i].inseclNodes.length; j++)
        if (data[i].inseclNodes[j] == insecNode)
          return data[i];

    // If we don't have any information on the node, then maybe on its parent
    insecNode = secureGet(insecNode, "parentNode");
  }

  return null;
};
abp.getDataForNode = DataContainer.getDataForNode;

// Adds a new handler to be notified whenever the location list is added
DataContainer.listeners = [];
DataContainer.addListener = function(handler) {
  DataContainer.listeners.push(handler);
};
  
// Removes a handler
DataContainer.removeListener = function(handler) {
  for (var i = 0; i < DataContainer.listeners.length; i++)
    if (DataContainer.listeners[i] == handler)
      DataContainer.listeners.splice(i--, 1);
};

// Calls all location listeners
DataContainer.notifyListeners = function(insecWnd, type, data, location) {
  for (var i = 0; i < DataContainer.listeners.length; i++)
    DataContainer.listeners[i](insecWnd, type, data, location);
};
