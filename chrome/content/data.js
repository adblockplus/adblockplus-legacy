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
 * Portions created by the Initial Developer are Copyright (C) 2006-2009
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * ***** END LICENSE BLOCK ***** */

/*
 * Stores Adblock Plus data to be attached to a window.
 * This file is included from AdblockPlus.js.
 */

const dataSeed = Math.random();    // Make sure our properties have randomized names
const docDataProp = "abpDocData" + dataSeed;
const nodeDataProp = "abpNodeData" + dataSeed;

function DataContainer(wnd) {
  this.entries = {__proto__: null};
  this.urls = {__proto__: null};
  this.subdocs = [];
  this.install(wnd);
}
abp.DataContainer = DataContainer;

DataContainer.prototype = {
  entries: null,
  urls: null,
  subdocs: null,
  topContainer: null,
  lastSelection: null,
  detached: false,

  /**
   * Weak reference to the window this data is attached to.
   * @type xpcIJSWeakReference
   */
  window: null,

  /**
   * Notifies all listeners about changes in this list or one of its sublists.
   * 
   */
  notifyListeners: function(type, data, location)
  {
    let wnd = this.window.get();
    if (this.detached || !wnd)
      return;

    for each (let listener in DataContainer._listeners)
      listener(wnd, type, data, location);
  },

  // Attaches the data to a window
  install: function(wnd) {
    this.window = Cu.getWeakReference(wnd);

    var topWnd = wnd.top;
    if (topWnd != wnd) {
      this.topContainer = DataContainer.getDataForWindow(topWnd);
      this.topContainer.registerSubdocument(this);
    }
    else
      this.topContainer = this;

    wnd.document[docDataProp] = this;

    this.installListeners(wnd);
  },

  installListeners: function(wnd) {
    var me = this;
    var hideHandler = function(ev) {
      if (!ev.isTrusted || ev.eventPhase != ev.AT_TARGET)
        return;

      if (me != me.topContainer)
        me.topContainer.unregisterSubdocument(me);
      else
        me.notifyListeners("clear", me);

      // We shouldn't send further notifications
      me.detached = true;
    };

    var showHandler = function(ev) {
      if (!ev.isTrusted || ev.eventPhase != ev.AT_TARGET)
        return;

      // Allow notifications again
      me.detached = false;

      if (me != me.topContainer)
        me.topContainer.registerSubdocument(me);
      else
        me.notifyListeners("select", me);
    };

    wnd.addEventListener("pagehide", hideHandler, false);
    wnd.addEventListener("pageshow", showHandler, false);
  },

  registerSubdocument: function(data) {
    for (var i = 0; i < this.subdocs.length; i++)
      if (this.subdocs[i] == data)
        return;

    this.subdocs.push(data);
    this.notifyListeners("refresh", this);
  },
  unregisterSubdocument: function(data) {
    for (var i = 0; i < this.subdocs.length; i++)
      if (this.subdocs[i] == data)
        this.subdocs.splice(i--, 1);

    this.notifyListeners("refresh", this);
  },
  addNode: function(node, contentType, docDomain, thirdParty, location, filter, objTab)
  {
    // for images repeated on page store node for each repeated image
    let key = " " + contentType + " " + location;
    let entry;
    let isNew = !(key in this.entries);
    if (isNew)
      this.entries[key] = this.urls[location] = entry = new DataEntry(contentType, docDomain, thirdParty, location);
    else
      entry = this.entries[key];

    // Always override the filter just in case a known node has been blocked
    if (filter)
      entry.filter = filter;

    entry.addNode(node);
    if (objTab)
      entry.addNode(objTab);

    if (isNew)
      this.topContainer.notifyListeners("add", this.topContainer, this.entries[key]);

    return entry;
  },

  getLocation: function(type, location) {
    var key = " " + type + " " + location;
    if (key in this.entries)
      return this.entries[key];

    for (var i = 0; i < this.subdocs.length; i++) {
      var result = this.subdocs[i].getLocation(type, location);
      if (result)
        return result;
    }

    return null;
  },
  getAllLocations: function(results) {
    if (typeof results == "undefined")
      results = [];
    for (var key in this.entries)
      if (key[0] == " ")
          results.push(this.entries[key]);

    for (var i = 0; i < this.subdocs.length; i++)
      this.subdocs[i].getAllLocations(results);

    return results;
  },

  getURLInfo: function(location)
  {
    return (location in this.urls ? this.urls[location] : null);
  }
};

// Loads Adblock data associated with a window object
DataContainer.getDataForWindow = function(wnd, noInstall) {
  if (docDataProp in wnd.document)
    return wnd.document[docDataProp];
  else if (!noInstall)
    return new DataContainer(wnd);
  else
    return null;
};
abp.getDataForWindow = DataContainer.getDataForWindow;

// Loads Adblock data associated with a node object
DataContainer.getDataForNode = function(node, noParent) {
  while (node) {
    if (nodeDataProp in node)
      return [node, node[nodeDataProp]];

    if (typeof noParent == "boolean" && noParent)
      return null;

    // If we don't have any information on the node, then maybe on its parent
    node = node.parentNode;
  }

  return null;
};
abp.getDataForNode = DataContainer.getDataForNode;

/**
 * List of registered data listeners
 * @type Array of Function
 * @static
 */
DataContainer._listeners = [];

/**
 * Adds a new listener to be notified whenever new requests are added to the list.
 * @static
 */
DataContainer.addListener = function(/**Function*/ listener)
{
  DataContainer._listeners.push(listener);
};
  
/**
 * Removes a listener.
 * @static
 */
DataContainer.removeListener = function(/**Function*/ listener)
{
  for (var i = 0; i < DataContainer._listeners.length; i++)
    if (DataContainer._listeners[i] == listener)
      DataContainer._listeners.splice(i--, 1);
};

function DataEntry(contentType, docDomain, thirdParty, location)
{
  this.nodes = [];
  this.type = contentType;
  this.docDomain = docDomain;
  this.thirdParty = thirdParty;
  this.location = location;
}
DataEntry.prototype =
{
  /**
   * Document elements associated with this entry (stored as weak references)
   * @type Array of xpcIJSWeakReference
   */
  nodes: null,
  /**
   * Content type of the request (one of the nsIContentPolicy constants)
   * @type Integer
   */
  type: null,
  /**
   * Domain name of the requesting document
   * @type String
   */
  docDomain: null,
  /**
   * True if the request goes to a different domain than the domain of the containing document
   * @type Boolean
   */
  thirdParty: false,
  /**
   * Address being requested
   * @type String
   */
  location: null,
  /**
   * Filter that was applied to this request (if any)
   * @type Filter
   */
  filter: null,
  /**
   * String representation of the content type, e.g. "subdocument"
   * @type String
   */
  get typeDescr() policy.typeDescr[this.type],
  /**
   * User-visible localized representation of the content type, e.g. "frame"
   * @type String
   */
  get localizedDescr() policy.localizedDescr[this.type],

  /**
   * Adds a new document element to be associated with this request.
   */
  addNode: function(/**Node*/ node)
  {
    // If we had this node already - remove it from its old data entry first
    if (nodeDataProp in node)
    {
      let nodes = node[nodeDataProp].nodes;
      for (let i = 0; i < nodes.length; i++)
      {
        let n = nodes[i].get();
        if (!n || n == node)
          nodes.splice(i--, 1);
      }
    }

    this.nodes.push(Cu.getWeakReference(node));
    node[nodeDataProp] = this;
  }
};
