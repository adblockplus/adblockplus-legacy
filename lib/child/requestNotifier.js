/*
 * This file is part of Adblock Plus <https://adblockplus.org/>,
 * Copyright (C) 2006-2016 Eyeo GmbH
 *
 * Adblock Plus is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3 as
 * published by the Free Software Foundation.
 *
 * Adblock Plus is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Adblock Plus.  If not, see <http://www.gnu.org/licenses/>.
 */

/**
 * @fileOverview Stores Adblock Plus data to be attached to a window.
 */
let {Services} = Cu.import("resource://gre/modules/Services.jsm", {});

let {port} = require("messaging");
let {Utils} = require("utils");
let {Flasher} = require("child/flasher");

let nodeData = new WeakMap();
let windowStats = new WeakMap();
let windowData = new WeakMap();
let requestEntryMaxId = 0;

/**
 * Active RequestNotifier instances by their ID
 * @type Map.<number,RequestNotifier>
 */
let notifiers = new Map();

port.on("startWindowScan", onStartScan);
port.on("shutdownNotifier", onNotifierShutdown);
port.on("flashNodes", onFlashNodes);
port.on("retrieveNodeSize", onRetrieveNodeSize);
port.on("storeNodesForEntries", onStoreNodes);
port.on("retrieveWindowStats", onRetrieveWindowStats);
port.on("storeWindowData", onStoreWindowData);
port.on("retrieveWindowData", onRetrieveWindowData);

function onStartScan({notifierID, outerWindowID})
{
  let window = Services.wm.getOuterWindowWithId(outerWindowID);
  if (window)
    new RequestNotifier(window, notifierID);
}

function onNotifierShutdown(notifierID)
{
  let notifier = notifiers.get(notifierID);
  if (notifier)
    notifier.shutdown();
}

function onFlashNodes({notifierID, requests, scrollToItem})
{
  let notifier = notifiers.get(notifierID);
  if (notifier)
    notifier.flashNodes(requests, scrollToItem);
}

function onRetrieveNodeSize({notifierID, requests})
{
  let notifier = notifiers.get(notifierID);
  if (notifier)
    return notifier.retrieveNodeSize(requests);
}

function onStoreNodes({notifierID, requests})
{
  let notifier = notifiers.get(notifierID);
  if (notifier)
    return notifier.storeNodesForEntries(requests);
}

function onRetrieveWindowStats(outerWindowID)
{
  let window = Services.wm.getOuterWindowWithId(outerWindowID);
  if (window)
    return RequestNotifier.getWindowStatistics(window);
}

function onStoreWindowData({outerWindowID, data})
{
  let window = Services.wm.getOuterWindowWithId(outerWindowID);
  if (window)
    windowData.set(window.document, data);
};

function onRetrieveWindowData(outerWindowID)
{
  let window = Services.wm.getOuterWindowWithId(outerWindowID);
  if (window)
    return windowData.get(window.document) || null;
};

/**
 * Creates a notifier object for a particular window. After creation the window
 * will first be scanned for previously saved requests. Once that scan is
 * complete only new requests for this window will be reported.
 * @param {Window} window  window to attach the notifier to
 * @param {Integer} notifierID  Parent notifier ID to be messaged
 */
function RequestNotifier(window, notifierID)
{
  this.window = window;
  this.id = notifierID;
  notifiers.set(this.id, this);
  this.nodes = new Map();
  this.startScan(window);
}
exports.RequestNotifier = RequestNotifier;

RequestNotifier.prototype =
{
  /**
   * Parent notifier ID to be messaged
   * @type Integer
   */
  id: null,

  /**
   * The window this notifier is associated with.
   * @type Window
   */
  window: null,

  /**
   * Nodes associated with a particular request ID.
   * @type Map.<number,Node>
   */
  nodes: null,

  /**
   * Shuts down the notifier once it is no longer used. The listener
   * will no longer be called after that.
   */
  shutdown: function()
  {
    delete this.window;
    delete this.nodes;
    this.stopFlashing();
    notifiers.delete(this.id);
  },

  /**
   * Notifies the parent about a new request.
   * @param {Node} node  DOM node that the request is associated with
   * @param {Object} entry
   */
  notifyListener: function(node, entry)
  {
    if (this.nodes)
      this.nodes.set(entry.id, node);
    port.emit("foundNodeData", {
      notifierID: this.id,
      data: entry
    });
  },

  onComplete: function()
  {
    port.emit("scanComplete", this.id);
  },

  /**
   * Number of currently posted scan events (will be 0 when the scan finishes
   * running).
   */
  eventsPosted: 0,

  /**
   * Starts the initial scan of the window (will recurse into frames).
   * @param {Window} wnd  the window to be scanned
   */
  startScan: function(wnd)
  {
    let doc = wnd.document;
    let walker = doc.createTreeWalker(doc, Ci.nsIDOMNodeFilter.SHOW_ELEMENT, null, false);

    let process = function()
    {
      // Don't do anything if the notifier was shut down already.
      if (!this.window)
        return;

      let node = walker.currentNode;
      let data = nodeData.get(node);
      if (typeof data != "undefined")
        for (let k in data)
          this.notifyListener(node, data[k]);

      if (walker.nextNode())
        Utils.runAsync(process);
      else
      {
        // Done with the current window, start the scan for its frames
        for (let i = 0; i < wnd.frames.length; i++)
          this.startScan(wnd.frames[i]);

        this.eventsPosted--;
        if (!this.eventsPosted)
        {
          this.scanComplete = true;
          this.onComplete();
        }
      }
    }.bind(this);

    // Process each node in a separate event to allow other events to process
    this.eventsPosted++;
    Utils.runAsync(process);
  },

  /**
   * Makes the nodes associated with the given requests blink.
   * @param {number[]} requests  list of request IDs that were previously
   *                             reported by this notifier.
   * @param {boolean} scrollToItem  if true, scroll to first node
   */
  flashNodes: function(requests, scrollToItem)
  {
    this.stopFlashing();

    let nodes = [];
    for (let id of requests)
    {
      if (!this.nodes.has(id))
        continue;

      let node = this.nodes.get(id);
      if (Cu.isDeadWrapper(node))
        this.nodes.delete(node);
      else if (node.nodeType == Ci.nsIDOMNode.ELEMENT_NODE)
        nodes.push(node);
    }
    if (nodes.length)
      this.flasher = new Flasher(nodes, scrollToItem);
  },

  /**
   * Stops flashing nodes after a previous flashNodes() call.
   */
  stopFlashing: function()
  {
    if (this.flasher)
      this.flasher.stop();
    this.flasher = null;
  },

  /**
   * Attempts to calculate the size of the nodes associated with the requests.
   * @param {number[]} requests  list of request IDs that were previously
   *                             reported by this notifier.
   * @return {number[]|null} either an array containing width and height or
   *                         null if the size could not be calculated.
   */
  retrieveNodeSize: function(requests)
  {
    function getNodeSize(node)
    {
      if (node instanceof Ci.nsIDOMHTMLImageElement && (node.naturalWidth || node.naturalHeight))
        return [node.naturalWidth, node.naturalHeight];
      else if (node instanceof Ci.nsIDOMHTMLElement && (node.offsetWidth || node.offsetHeight))
        return [node.offsetWidth, node.offsetHeight];
      else
        return null;
    }

    let size = null;
    for (let id of requests)
    {
      if (!this.nodes.has(id))
        continue;

      let node = this.nodes.get(id);
      if (Cu.isDeadWrapper(node))
        this.nodes.delete(node);
      else
      {
        size = getNodeSize(node);
        if (size)
          break;
      }
    }
    return size;
  },

  /**
   * Stores the nodes associated with the requests and generates a unique ID
   * for them that can be used with Policy.refilterNodes().
   * @param {number[]} requests  list of request IDs that were previously
   *                             reported by this notifier.
   * @return {string} unique identifiers associated with the nodes.
   */
  storeNodesForEntries: function(requests)
  {
    let nodes = [];
    for (let id of requests)
    {
      if (!this.nodes.has(id))
        continue;

      let node = this.nodes.get(id);
      if (Cu.isDeadWrapper(node))
        this.nodes.delete(node);
      else
        nodes.push(node);
    }

    let {storeNodes} = require("child/contentPolicy");
    return storeNodes(nodes);
  }
};

/**
 * Attaches request data to a DOM node.
 * @param {Node} node   node to attach data to
 * @param {Window} topWnd   top-level window the node belongs to
 * @param {Object} hitData
 * @param {String} hitData.contentType   request type, e.g. "IMAGE"
 * @param {String} hitData.docDomain  domain of the document that initiated the request
 * @param {Boolean} hitData.thirdParty  will be true if a third-party server has been requested
 * @param {String} hitData.location   the address that has been requested
 * @param {String} hitData.filter   filter applied to the request or null if none
 * @param {String} hitData.filterType  type of filter applied to the request
 */
RequestNotifier.addNodeData = function(node, topWnd, {contentType, docDomain, thirdParty, location, filter, filterType})
{
  let entry = {
    id: ++requestEntryMaxId,
    type: contentType,
    docDomain, thirdParty, location, filter
  };

  let existingData = nodeData.get(node);
  if (typeof existingData == "undefined")
  {
    existingData = {};
    nodeData.set(node, existingData);
  }

  // Add this request to the node data
  existingData[contentType + " " + location] = entry;

  // Update window statistics
  if (!windowStats.has(topWnd.document))
  {
    windowStats.set(topWnd.document, {
      items: 0,
      hidden: 0,
      blocked: 0,
      whitelisted: 0,
      filters: {}
    });
  }

  let stats = windowStats.get(topWnd.document);
  if (filterType != "elemhide" && filterType != "elemhideexception" && filterType != "cssproperty")
    stats.items++;
  if (filter)
  {
    if (filterType == "blocking")
      stats.blocked++;
    else if (filterType == "whitelist" || filterType == "elemhideexception")
      stats.whitelisted++;
    else if (filterType == "elemhide" || filterType == "cssproperty")
      stats.hidden++;

    if (filter in stats.filters)
      stats.filters[filter]++;
    else
      stats.filters[filter] = 1;
  }

  // Notify listeners
  for (let notifier of notifiers.values())
    if (!notifier.window || notifier.window == topWnd)
      notifier.notifyListener(node, entry);
}

/**
 * Retrieves the statistics for a window.
 * @return {Object} Object with the properties items, blocked, whitelisted, hidden, filters containing statistics for the window (might be null)
 */
RequestNotifier.getWindowStatistics = function(/**Window*/ wnd)
{
  if (windowStats.has(wnd.document))
    return windowStats.get(wnd.document);
  else
    return null;
}

/**
 * Retrieves the request data associated with a DOM node.
 * @param {Node} node
 * @param {Boolean} noParent  if missing or false, the search will extend to the parent nodes until one is found that has data associated with it
 * @param {Integer} [type] request type to be looking for
 * @param {String} [location] request location to be looking for
 * @result {[Node, Object]}
 * @static
 */
RequestNotifier.getDataForNode = function(node, noParent, type, location)
{
  while (node)
  {
    let data = nodeData.get(node);
    if (typeof data != "undefined")
    {
      let entry = null;
      // Look for matching entry
      for (let k in data)
      {
        if ((!entry || entry.id < data[k].id) &&
            (typeof type == "undefined" || data[k].type == type) &&
            (typeof location == "undefined" || data[k].location == location))
        {
          entry = data[k];
        }
      }
      if (entry)
        return [node, entry];
    }

    // If we don't have any match on this node then maybe its parent will do
    if ((typeof noParent != "boolean" || !noParent) &&
        node.parentNode instanceof Ci.nsIDOMElement)
    {
      node = node.parentNode;
    }
    else
    {
      node = null;
    }
  }

  return null;
};
