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

function DataContainer() {
  this.locations = {};
  this.locationListeners = [];
  this.wrappedJSObject = this;
}
DataContainer.prototype = {
  insecDoc: null,

  // nsIController interface implementation
  insecCommandEnabled: function(command) {
    return false;
  },
  supportsCommand: function(command) {
    return (command == "abp");
  },

  // nsISupports interface implementation
  QueryInterface: function(iid) {
    if (!iid.equals(Components.interfaces.nsISupports) &&
        !iid.equals(Components.interfaces.nsIController)) {

      if (!iid.equals(Components.interfaces.nsIClassInfo) &&
          !iid.equals(Components.interfaces.nsIControllerContext) &&
          !iid.equals(Components.interfaces.nsISecurityCheckedComponent))
        dump("Adblock Plus: FakeController.QI to an unknown interface: " + iid + "\n");

      throw Components.results.NS_ERROR_NO_INTERFACE;
    }

    return this;
  },

  // Custom methods
  clear: function() {
    this.notifyLocationListeners(null, false);
    this.locations = {};
  },
  install: function(insecWnd) {
    // Remove any previously installed controllers first
    var controller;
    while ((controller = secureLookup(insecWnd, "controllers", "getControllerForCommand")("abp")) != null)
      secureLookup(insecWnd, "controllers", "removeController")(controller);

    this.insecDoc = secureGet(insecWnd, "document");
    secureLookup(insecWnd, "controllers", "appendController")(this);
  },
  validate: function(insecWnd) {
    var insecDoc = secureGet(insecWnd, "document");
    if (this.insecDoc != insecDoc) {
      // We have data for the wrong document
      this.clear();
      this.insecDoc = insecDoc;
    }
  },
  addNode: function(insecNode, contentType, location, filter) {
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
      this.notifyLocationListeners(this.locations[key], true);
    }
  },
  getLocation: function(location) {
    var key = " " + location;
    return this.checkNodes(key);
  },
  getAllLocations: function() {
    var results = [];
    for (var key in this.locations) {
      if (key.match(/^ /)) {
        var data = this.checkNodes(key);
        if (data)
          results.push(data);
      }
    }
    return results;
  },

  // Adds a new handler to be notified whenever the location list is added
  addLocationListener: function(handler) {
    this.locationListeners.push(handler);
  },
  
  // Removes a handler
  removeLocationListener: function(handler) {
    for (var i = 0; i < this.locationListeners.length; i++)
      if (this.locationListeners[i] == handler)
        this.locationListeners.splice(i--, 1);
  },

  // Calls all location listeners
  notifyLocationListeners: function(location, added) {
    for (var i = 0; i < this.locationListeners.length; i++)
      this.locationListeners[i](location, added);
  },

  // Makes sure that all nodes still valid (have a view associated with them)
  checkNodes: function(key) {
    if (!(key in this.locations))
      return null;

    var data = this.locations[key];
    for (var i = 0; i < data.inseclNodes.length; i++) {
      var insecNode = data.inseclNodes[i];
      var valid = true;
      
      // Special handling for subdocuments - those nodes might be still valid,
      // but the have been readded for another URL
      if (data.type == type.SUBDOCUMENT)
        valid = (secureGet(insecNode, "contentWindow", "location", "href") == data.location);
      else if (secureGet(insecNode, "nodeType") == Node.ELEMENT_NODE)
        valid = secureGet(insecNode, "ownerDocument", "defaultView");
      else if (secureGet(insecNode, "nodeType") == Node.DOCUMENT_NODE)
        valid = secureGet(insecNode, "defaultView");

      if (!valid)
        data.inseclNodes.splice(i--, 1);
    }

    if (data.inseclNodes.length > 0)
      return data;
    else {
      this.notifyLocationListeners(data, false);
      delete this.locations[key];
      return null;
    }
  }
};

// Loads Adblock data associated with a window object
DataContainer.getDataForWindow = function(insecWnd) {
  var data = secureLookup(insecWnd, "controllers", "getControllerForCommand")("abp");
  while (data && !("validate" in data))
    data = data.wrappedJSObject;

  if (!data) {
    data = new DataContainer();
    data.install(insecWnd);
  }
  else
    data.validate(insecWnd);

  return data;
};

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

abp.getDataForWindow = DataContainer.getDataForWindow;
abp.getDataForNode = DataContainer.getDataForNode;
