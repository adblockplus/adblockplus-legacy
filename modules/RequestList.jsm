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
 * Portions created by the Initial Developer are Copyright (C) 2006-2010
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * ***** END LICENSE BLOCK ***** */

/**
 * @fileOverview Stores Adblock Plus data to be attached to a window.
 */

var EXPORTED_SYMBOLS = ["RequestList"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

let baseURL = Cc["@adblockplus.org/abp/private;1"].getService(Ci.nsIURI);

Cu.import(baseURL.spec + "Utils.jsm");
Utils.runAsync(Cu.import, Cu, baseURL.spec + "ContentPolicy.jsm");  // delay to avoid circular imports

const dataSeed = Math.random();    // Make sure our properties have randomized names
const docDataProp = "abpDocData" + dataSeed;
const nodeDataProp = "abpNodeData" + dataSeed;
const nodeIndexProp = "abpNodeIndex" + dataSeed;
var nodeIndex = 0;

function RequestList(wnd) {
  this.entries = {__proto__: null};
  this.urls = {__proto__: null};
  this.install(wnd);
}

RequestList.prototype = {
  entries: null,
  urls: null,
  topList: null,
  lastSelection: null,
  detached: false,

  /**
   * Weak reference to the window this data is attached to.
   * @type nsIWeakReference
   */
  window: null,
  /**
   * Counter to be incremented every time an entry is added - list will be compacted when a threshold is reached.
   * @type Integer
   */
  _compactCounter: 0,
  /**
   * Time in milliseconds of the last list cleanup, makes sure cleanup isn't triggered too often.
   * @type Integer
   */
  _lastCompact: 0,

  /**
   * Attaches this request list to a window.
   */
  install: function(/**Window*/ wnd)
  {
    this.window = getWeakReference(wnd);
    wnd.document[docDataProp] = this;

    let topWnd = wnd.top;
    if (topWnd != wnd)
    {
      this.topList = RequestList.getDataForWindow(topWnd);
      this.topList.notifyListeners("refresh");
    }
    else
      this.topList = this;

    let me = this;
    wnd.addEventListener("pagehide", function(ev)
    {
      if (!ev.isTrusted || ev.eventPhase != ev.AT_TARGET)
        return;

      if (me == me.topList)
        me.notifyListeners("clear");

      // We shouldn't send further notifications
      me.detached = true;

      if (me != me.topList)
        me.topList.notifyListeners("refresh");
    }, false);
    wnd.addEventListener("pageshow", function(ev)
    {
      if (!ev.isTrusted || ev.eventPhase != ev.AT_TARGET)
        return;

      // Allow notifications again
      me.detached = false;

      if (me != me.topList)
        me.topList.notifyListeners("refresh");
      else
        me.notifyListeners("select");
    }, false);
  },

  /**
   * Notifies all listeners about changes in this list or one of its sublists.
   * @param {String} type   type of notification, one of "add", "refresh", "select", "clear"
   * @param {RequestEntry} entry   data entry being updated (only present for type "add")
   */
  notifyListeners: function(type, entry)
  {
    let wnd = getReferencee(this.window);
    if (this.detached || !wnd)
      return;

    for each (let listener in RequestList._listeners)
      listener(wnd, type, this, entry);
  },

  addNode: function(node, contentType, docDomain, thirdParty, location, filter)
  {
    // for images repeated on page store node for each repeated image
    let key = " " + contentType + " " + location;
    let entry;
    let isNew = !(key in this.entries);
    if (isNew)
      this.entries[key] = this.urls[location] = entry = new RequestEntry(key, contentType, docDomain, thirdParty, location);
    else
      entry = this.entries[key];

    // Always override the filter just in case a known node has been blocked
    if (filter)
      entry.filter = filter;

    entry.addNode(node);

    if (isNew)
      this.topList.notifyListeners("add", this.entries[key]);

    // Compact the list of entries after 100 additions but at most once every 5 seconds
    if (isNew && ++this._compactCounter >= 100 && Date.now() - this._lastCompact > 5000)
      this.getAllLocations();

    return entry;
  },

  getLocation: function(type, location)
  {
    let key = " " + type + " " + location;
    if (key in this.entries)
      return this.entries[key];

    let wnd = getReferencee(this.window);
    let numFrames = (wnd ? wnd.frames.length : -1);
    for (let i = 0; i < numFrames; i++)
    {
      let frameData = RequestList.getDataForWindow(wnd.frames[i], true);
      if (frameData && !frameData.detached)
      {
        let result = frameData.getLocation(type, location);
        if (result)
          return result;
      }
    }

    return null;
  },

  getAllLocations: function(results, hadOutdated)
  {
    let now = Date.now();

    // Accessing wnd.frames will flush outstanding content policy requests in Gecko 1.9.0/1.9.1.
    // Access it now to make sure we return the correct result even if more nodes are added here.
    let wnd = getReferencee(this.window);
    let frames = wnd.frames;

    this._compactCounter = 0;
    this._lastCompact = now;

    if (typeof results == "undefined")
      results = [];

    let recursiveCall = true;
    if (typeof hadOutdated == "undefined")
    {
      recursiveCall = false;
      hadOutdated = {value: false};
    }
    for (var key in this.entries)
    {
      if (key[0] == " ")
      {
        let entry = this.entries[key];
        if (!entry.hasAdditionalNodes && now - entry.lastUpdate >= 60000 && !entry.nodes.length)
        {
          hadOutdated.value = true;
          delete this.entries[key];
        }
        else
          results.push(this.entries[key]);
      }
    }

    let numFrames = (wnd ? frames.length : -1);
    for (let i = 0; i < numFrames; i++)
    {
      let frameData = RequestList.getDataForWindow(frames[i], true);
      if (frameData && !frameData.detached)
        frameData.getAllLocations(results, hadOutdated);
    }

    if (!recursiveCall && hadOutdated.value)
      this.topList.notifyListeners("refresh");

    return results;
  },

  getURLInfo: function(location)
  {
    return (location in this.urls ? this.urls[location] : null);
  }
};

/**
 * Retrieves the data list associated with a window.
 * @param {Window} window
 * @param {Boolean} noInstall  if missing or false, a new empty list will be created and returned if no data is associated with the window yet.
 * @result {RequestList}
 * @static
 */
RequestList.getDataForWindow = function(wnd, noInstall)
{
  if (wnd.document && docDataProp in wnd.document)
    return wnd.document[docDataProp];
  else if (!noInstall)
    return new RequestList(wnd);
  else
    return null;
};

/**
 * Retrieves the data entry associated with the document element.
 * @param {Node} node
 * @param {Boolean} noParent  if missing or false, the search will extend to the parent nodes until one is found that has data associated with it
 * @result {RequestEntry}
 * @static
 */
RequestList.getDataForNode = function(node, noParent)
{
  while (node)
  {
    let entryKey = node.getUserData(nodeDataProp);
    if (entryKey)
    {
      let wnd = Utils.getWindow(node);
      let data = (wnd ? RequestList.getDataForWindow(wnd, true) : null);
      if (data && entryKey in data.entries)
        return [node, data.entries[entryKey]];
    }

    if (typeof noParent == "boolean" && noParent)
      return null;

    // If we don't have any information on the node, then maybe on its parent
    node = node.parentNode;
  }

  return null;
};

/**
 * List of registered data listeners
 * @type Array of Function
 * @static
 */
RequestList._listeners = [];

/**
 * Adds a new listener to be notified whenever new requests are added to the list.
 * @static
 */
RequestList.addListener = function(/**Function*/ listener)
{
  RequestList._listeners.push(listener);
};
  
/**
 * Removes a listener.
 * @static
 */
RequestList.removeListener = function(/**Function*/ listener)
{
  for (var i = 0; i < RequestList._listeners.length; i++)
    if (RequestList._listeners[i] == listener)
      RequestList._listeners.splice(i--, 1);
};

function RequestEntry(key, contentType, docDomain, thirdParty, location)
{
  this._nodes = [];
  this._indexes = [];
  this.key = key;
  this.type = contentType;
  this.docDomain = docDomain;
  this.thirdParty = thirdParty;
  this.location = location;
}
RequestEntry.prototype =
{
  /**
   * Document elements associated with this entry (stored as weak references)
   * @type Array of nsIWeakReference
   */
  _nodes: null,
  /**
   * Nodes indexes corresponding with the nodes - used to recognize outdated entries.
   * @type Array of Integer
   */
  _indexes: null,
  /**
   * Will be set to true if the entry is associated with other nodes besides the
   * ones listed in the nodes property - used if obtaining a weak reference to
   * some nodes isn't possible.
   * @type Boolean
   */
  hasAdditionalNodes: false,
  /**
   * Counter to be incremented every time a node is added - list will be compacted when a threshold is reached.
   * @type Integer
   */
  _compactCounter: 0,
  /**
   * Time in milliseconds of the last list cleanup, makes sure cleanup isn't triggered too often.
   * @type Integer
   */
  _lastCompact: 0,
  /**
   * Time out last node addition or compact operation (used to find outdated entries).
   * @type Integer
   */
  lastUpdate: 0,
  /**
   * ID of this entry in document's list
   * @type String
   */
  key: null,
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
   * Document elements associated with this entry
   * @type Array of Element
   */
  get nodes()
  {
    this._compactCounter = 0;
    this.lastUpdate = this._lastCompact = Date.now();

    let result = [];
    for (let i = 0; i < this._nodes.length; i++)
    {
      let node = getReferencee(this._nodes[i]);

      // Remove node if associated with a different weak reference - this node was added to a different list already
      if (node && node.getUserData(nodeIndexProp) == this._indexes[i])
        result.push(node);
      else
      {
        this._nodes.splice(i, 1);
        this._indexes.splice(i, 1);
        i--;
      }
    }
    return result;
  },
  /**
   * String representation of the content type, e.g. "subdocument"
   * @type String
   */
  get typeDescr() Policy.typeDescr[this.type],
  /**
   * User-visible localized representation of the content type, e.g. "frame"
   * @type String
   */
  get localizedDescr() Policy.localizedDescr[this.type],

  /**
   * Adds a new document element to be associated with this request.
   */
  addNode: function(/**Node*/ node)
  {
    // Compact the list of nodes after 100 additions but at most once every 5 seconds
    if (++this._compactCounter >= 100 && Date.now() - this._lastCompact > 5000)
      this.nodes;
    else
      this.lastUpdate = Date.now();

    node.setUserData(nodeDataProp, this.key, null);

    let weakRef = getWeakReference(node);
    if (weakRef)
    {
      this._nodes.push(weakRef);

      ++nodeIndex;
      node.setUserData(nodeIndexProp, nodeIndex, null);
      this._indexes.push(nodeIndex);
    }
    else
      this.hasAdditionalNodes = true;
  },

  /**
   * Associates a document element with a request without adding it to the list.
   */
  attachTo: function(/**Node*/ node)
  {
    node.setUserData(nodeDataProp, this.key, null);
  },

  /**
   * Resets the list of document elements associated with this entry.
   * @return {Array of Node} old list of elements
   */
  clearNodes: function()
  {
    let result = this.nodes;
    this._nodes = [];
    this._indexes = [];
    return result;
  }
};

/**
 * Stores a weak reference to a DOM node (will store a reference to original node if wrapped).
 */
function getWeakReference(/**nsISupports*/ node) /**nsIWeakReference*/
{
  if (node instanceof Ci.nsISupportsWeakReference)
    return node.GetWeakReference();
  else
    return null;
}

/**
 * Retrieves a DOM node from a weak reference, restores XPCNativeWrapper if necessary.
 */
function getReferencee(/**nsIWeakReference*/ weakRef) /**nsISupports*/
{
  try {
    return weakRef.QueryReferent(Ci.nsISupports);
  } catch (e) {
    return null;
  }
}
