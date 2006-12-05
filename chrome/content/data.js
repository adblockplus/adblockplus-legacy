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

var dataSeed = Math.random();    // Make sure our properties have randomized names

function DataContainer(wnd) {
  this.locations = {};
  this.subdocs = [];
  this.install(wnd);
}
abp.DataContainer = DataContainer;

DataContainer.prototype = {
  topContainer: null,
  newLocation: null,
  lastSelection: null,
  detached: false,

  // Attaches the data to a window
  install: function(wnd) {
    var topWnd = wnd.top;
    if (topWnd != wnd) {
      this.topContainer = DataContainer.getDataForWindow(topWnd);
      this.topContainer.registerSubdocument(topWnd, this);
    }
    else
      this.topContainer = this;

    wnd.document["abpData" + dataSeed] = this;

    this.installListeners(wnd);
  },

  installListeners: function(wnd) {
    var me = this;
    var hideHandler = function(ev) {
      if (!ev.isTrusted || ev.eventPhase != ev.AT_TARGET)
        return;

      if (me != me.topContainer)
        me.topContainer.unregisterSubdocument(this.top, me);
      else
        DataContainer.notifyListeners(this, "clear", me);

      // We shouldn't send further notifications
      me.detached = true;

      if (me.newLocation) {
        // Make sure to re-add the frame - we are not really going away
        var location = me.newLocation;
        createTimer(function() {
          var wnd = location.nodes[0];
          if (!wnd.document)
            return;

          var topWnd = wnd.top;
          var data = DataContainer.getDataForWindow(wnd);
          data.addNode(topWnd, wnd, location.type, location.location, location.filter, true);
        }, 0);
        me.newLocation = null;
      }
    }

    var showHandler = function(ev) {
      if (!ev.isTrusted || ev.eventPhase != ev.AT_TARGET)
        return;

      // Allow notifications again
      me.detached = false;

      if (me != me.topContainer)
        me.topContainer.registerSubdocument(this.top, me);
      else
        DataContainer.notifyListeners(this, "select", me);
    }
    wnd.addEventListener("pagehide", hideHandler, false);
    wnd.addEventListener("pageshow", showHandler, false);
  },

  registerSubdocument: function(topWnd, data) {
    for (var i = 0; i < this.subdocs.length; i++)
      if (this.subdocs[i] == data)
        return;

    this.subdocs.push(data);
    if (!this.detached)
      DataContainer.notifyListeners(topWnd, "refresh", this);
  },
  unregisterSubdocument: function(topWnd, data) {
    for (var i = 0; i < this.subdocs.length; i++)
      if (this.subdocs[i] == data)
        this.subdocs.splice(i--, 1);

    if (!this.detached)
      DataContainer.notifyListeners(topWnd, "refresh", this);
  },
  addNode: function(topWnd, node, contentType, location, filter, storedLoc, objTab) {
    if (contentType == type.SUBDOCUMENT && typeof storedLoc == "undefined" && (!filter || filter.type == "whitelist")) {
      // New document is about to load
      this.newLocation = {nodes: [node], type: contentType, location: location, filter: filter};
      return;
    }

    // for images repeated on page store node for each repeated image
    var key = " " + location;
    if (key in this.locations) {
      // Always override the filter just in case a known node has been blocked
      this.locations[key].filter = filter;
      this.locations[key].nodes.push(node);
    }
    else {
      // Add a new location and notify the listeners
      this.locations[key] = {
        nodes: [node],
        location: location,
        type: contentType,
        typeDescr: typeDescr[contentType],
        localizedDescr: localizedDescr[contentType],
        filter: filter
      };

      if (!this.topContainer.detached)
        DataContainer.notifyListeners(topWnd, "add", this.topContainer, this.locations[key]);
    }

    if (typeof objTab != "undefined" && objTab)
      this.locations[key].nodes.push(objTab);
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
DataContainer.getDataForWindow = function(wnd) {
  var doc = wnd.document;
  if ("abpData" + dataSeed in doc)
    return doc["abpData" + dataSeed];
  else
    return new DataContainer(wnd);
};
abp.getDataForWindow = DataContainer.getDataForWindow;

// Loads Adblock data associated with a node object
DataContainer.getDataForNode = function(node) {
  var wnd = getWindow(node);
  if (!wnd)
    return null;

  var data = DataContainer.getDataForWindow(wnd).getAllLocations();
  while (node) {
    for (var i = 0; i < data.length; i++)
      for (var j = 0; j < data[i].nodes.length; j++)
        if (data[i].nodes[j] == node)
          return data[i];

    // If we don't have any information on the node, then maybe on its parent
    node = node.parentNode;
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
DataContainer.notifyListeners = function(wnd, type, data, location) {
  for (var i = 0; i < DataContainer.listeners.length; i++)
    DataContainer.listeners[i](wnd, type, data, location);
};
