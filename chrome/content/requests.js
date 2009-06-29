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

function RequestList(wnd) {
  this.entries = {__proto__: null};
  this.urls = {__proto__: null};
  this.install(wnd);
}
abp.RequestList = RequestList;

RequestList.prototype = {
  entries: null,
  urls: null,
  topList: null,
  lastSelection: null,
  detached: false,

  /**
   * Weak reference to the window this data is attached to.
   * @type xpcIJSWeakReference
   */
  window: null,

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

  addNode: function(node, contentType, docDomain, thirdParty, location, filter, objTab)
  {
    // for images repeated on page store node for each repeated image
    let key = " " + contentType + " " + location;
    let entry;
    let isNew = !(key in this.entries);
    if (isNew)
      this.entries[key] = this.urls[location] = entry = new RequestEntry(contentType, docDomain, thirdParty, location);
    else
      entry = this.entries[key];

    // Always override the filter just in case a known node has been blocked
    if (filter)
      entry.filter = filter;

    entry.addNode(node);
    if (objTab)
      entry.addNode(objTab);

    if (isNew)
      this.topList.notifyListeners("add", this.entries[key]);

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
  getAllLocations: function(results)
  {
    if (typeof results == "undefined")
      results = [];
    for (var key in this.entries)
      if (key[0] == " ")
          results.push(this.entries[key]);

    let wnd = getReferencee(this.window);
    let numFrames = (wnd ? wnd.frames.length : -1);
    for (let i = 0; i < numFrames; i++)
    {
      let frameData = RequestList.getDataForWindow(wnd.frames[i], true);
      if (frameData && !frameData.detached)
        frameData.getAllLocations(results);
    }

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
    if (nodeDataProp in node)
      return [node, node[nodeDataProp]];

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

function RequestEntry(contentType, docDomain, thirdParty, location)
{
  this._nodes = [];
  this._lastCompact = Date.now();
  this.type = contentType;
  this.docDomain = docDomain;
  this.thirdParty = thirdParty;
  this.location = location;
}
RequestEntry.prototype =
{
  /**
   * Document elements associated with this entry (stored as weak references)
   * @type Array of xpcIJSWeakReference
   */
  _nodes: null,
  /**
   * Time when the list of nodes has been compacted last time.
   * @type Integer
   */
  _lastCompact: 0,
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
    this._lastCompact = Date.now();

    let result = [];
    for (let i = 0; i < this._nodes.length; i++)
    {
      let node = getReferencee(this._nodes[i]);
      if (node)
        result.push(node);
      else
        this._nodes.splice(i--, 1);
    }
    return result;
  },
  /**
   * Document elements associated with this entry
   * @type Iterator of Element
   */
  get nodesIterator()
  {
    this._lastCompact = Date.now();

    for (let i = 0; i < this._nodes.length; i++)
    {
      let node = getReferencee(this._nodes[i]);
      if (node)
        yield node;
      else
        this._nodes.splice(i--, 1);
    }
  },
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
      let oldEntry = node[nodeDataProp];
      let index = oldEntry.nodes.indexOf(node);
      if (index >= 0)
        oldEntry._nodes.splice(index, 1);
    }

    if (this._nodes.length >= 20 && Date.now() - this._lastCompact >= 60000)   // Compact the list of nodes every minute
      this.nodes;

    if (node instanceof Element)
    {
      this._nodes.push(getWeakReference(node));
      node[nodeDataProp] = this;
    }
  },

  /**
   * Resets the list of document elements associated with this entry.
   * @return {Array of Node} old list of elements
   */
  clearNodes: function()
  {
    let result = this.nodes;
    this._nodes = [];
    return result;
  }
};

/**
 * Stores a weak reference to a DOM node (will store a reference to original node if wrapped).
 */
function getWeakReference(node)
{
  return Cu.getWeakReference(node.QueryInterface(Ci.nsISupportsWeakReference));
}


let fakeFactory = {
  result: null,
  createInstance: function(outer, iid) this.result,
  QueryInterface: XPCOMUtils.generateQI([Ci.nsIFactory])
};
let fakeFactoryWrapped;
{
  let array = Cc["@mozilla.org/array;1"].createInstance(Ci.nsIMutableArray);
  array.appendElement(fakeFactory, false);
  fakeFactoryWrapped = array.queryElementAt(0, Ci.nsIFactory);
}

/**
 * Retrieves a DOM node from a weak reference, restores XPCNativeWrapper if necessary.
 */
function getReferencee(weakRef)
{
  let node = weakRef.get();
  if (node === null)
    return null;

  // HACK: Pass the node through XPCOM to get the wrapper back (bug 500931)
  fakeFactory.result = node;
  let result = fakeFactoryWrapped.createInstance(null, Ci.nsISupports);
  fakeFactory.result = node;
  return result;
}
