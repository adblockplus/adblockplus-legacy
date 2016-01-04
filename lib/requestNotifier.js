/*
 * This file is part of Adblock Plus <https://adblockplus.org/>,
 * Copyright (C) 2006-2015 Eyeo GmbH
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

let {Utils} = require("utils");

let windowSelection = new WeakMap();
let requestNotifierMaxId = 0;

let windowStatsMaxResponseID = 0;
let windowStatsCallbacks = new Map();

let windowDataMaxResponseID = 0;
let windowDataCallbacks = new Map();

/**
 * Active RequestNotifier instances by their ID
 * @type Map.<number,RequestNotifier>
 */
let notifiers = new Map();

let messageManager = Cc["@mozilla.org/parentprocessmessagemanager;1"]
                       .getService(Ci.nsIMessageListenerManager)
                       .QueryInterface(Ci.nsIMessageBroadcaster);

Utils.addChildMessageListener("AdblockPlus:FoundNodeData", onNodeData);
Utils.addChildMessageListener("AdblockPlus:ScanComplete", onScanComplete);
Utils.addChildMessageListener("AdblockPlus:NotifierResponse", onNotifierResponse);
Utils.addChildMessageListener("AdblockPlus:RetrieveWindowStatsResponse", onWindowStatsReceived);
Utils.addChildMessageListener("AdblockPlus:RetrieveWindowDataResponse", onWindowDataReceived);

function onNodeData({notifierID, data})
{
  let notifier = notifiers.get(notifierID);
  if (notifier)
    notifier.notifyListener(data);
}

function onScanComplete(notifierID)
{
  let notifier = notifiers.get(notifierID);
  if (notifier)
    notifier.onComplete();
}

function onNotifierResponse({notifierID, responseID, response})
{
  let notifier = notifiers.get(notifierID);
  if (notifier)
    notifier.onResponse(responseID, response);
}

function onWindowStatsReceived({responseID, stats})
{
  let callback = windowStatsCallbacks.get(responseID);
  windowStatsCallbacks.delete(responseID);
  if (typeof callback == "function")
    callback(stats);
}

function onWindowDataReceived({responseID, data})
{
  let callback = windowDataCallbacks.get(responseID);
  windowDataCallbacks.delete(responseID);
  if (typeof callback == "function")
    callback(data);
}

/**
 * Creates a notifier object for a particular window. After creation the window
 * will first be scanned for previously saved requests. Once that scan is
 * complete only new requests for this window will be reported.
 * @param {Integer} outerWindowID  ID of the window to attach the notifier to
 * @param {Function} listener  listener to be called whenever a new request is found
 * @param {Object} [listenerObj]  "this" pointer to be used when calling the listener
 */
function RequestNotifier(outerWindowID, listener, listenerObj)
{
  this.listener = listener;
  this.listenerObj = listenerObj || null;
  this.id = ++requestNotifierMaxId;
  notifiers.set(this.id, this);
  this._callbacks = new Map();

  messageManager.broadcastAsyncMessage("AdblockPlus:StartWindowScan", {
    notifierID: this.id,
    outerWindowID: outerWindowID
  });
}
exports.RequestNotifier = RequestNotifier;

RequestNotifier.prototype =
{
  /**
   * The unique ID of this notifier.
   * @type Integer
   */
  id: null,

  /**
   * The listener to be called when a new request is found.
   * @type Function
   */
  listener: null,

  /**
   * "this" pointer to be used when calling the listener.
   * @type Object
   */
  listenerObj: null,

  /**
   * Will be set to true once the initial window scan is complete.
   * @type Boolean
   */
  scanComplete: false,

  /**
   * Shuts down the notifier once it is no longer used. The listener
   * will no longer be called after that.
   */
  shutdown: function()
  {
    notifiers.delete(this.id);
    messageManager.broadcastAsyncMessage("AdblockPlus:ShutdownNotifier", this.id);
  },

  /**
   * Notifies listener about a new request.
   * @param {Object} entry
   */
  notifyListener: function(entry)
  {
    this.listener.call(this.listenerObj, entry, this.scanComplete);
  },

  onComplete: function()
  {
    this.scanComplete = true;
    this.notifyListener(null);
  },

  /**
   * Makes the nodes associated with the given requests blink.
   * @param {number[]} requests  list of request IDs that were previously
   *                             reported by this notifier.
   * @param {Boolean} scrollToItem  if true, scroll to first node
   */
  flashNodes: function(requests, scrollToItem)
  {
    if (!requests)
      requests = [];

    messageManager.broadcastAsyncMessage("AdblockPlus:FlashNodes", {
      notifierID: this.id,
      requests,
      scrollToItem
    });
  },

  _maxResponseID: 0,
  _callbacks: null,

  /**
   * Attempts to calculate the size of the nodes associated with the requests.
   * @param {number[]} requests  list of request IDs that were previously
   *                             reported by this notifier.
   * @param {Function} callback  function to be called with two parameters (x,y)
   */
  retrieveNodeSize: function(requests, callback)
  {
    if (!requests)
      requests = [];

    let id = ++this._maxResponseID;
    this._callbacks.set(id, callback);

    messageManager.broadcastAsyncMessage("AdblockPlus:RetrieveNodeSize", {
      notifierID: this.id,
      responseID: id,
      requests,
    });
  },

  onResponse: function(responseID, response)
  {
    let callback = this._callbacks.get(responseID);
    this._callbacks.delete(responseID);
    if (typeof callback == "function")
      callback(response);
  },

  /**
   * Stores the nodes associated with the requests and generates a unique ID
   * for them that can be used with Policy.refilterNodes(). Note that
   * Policy.deleteNodes() always has to be called to release the memory.
   * @param {number[]} requests  list of request IDs that were previously
   *                             reported by this notifier.
   * @param {Function} callback  function to be called with the nodes ID.
   */
  storeNodesForEntries: function(requests, callback)
  {
    if (!requests)
      requests = [];

    let id = ++this._maxResponseID;
    this._callbacks.set(id, callback);

    messageManager.broadcastAsyncMessage("AdblockPlus:StoreNodesForEntries", {
      notifierID: this.id,
      responseID: id,
      requests,
    });
  }
};

/**
 * Associates a piece of data with a particular window.
 * @param {number} outerWindowID  the ID of the window
 * @static
 */
RequestNotifier.storeWindowData = function(outerWindowID, data)
{
  messageManager.broadcastAsyncMessage("AdblockPlus:StoreWindowData", {
    outerWindowID,
    data
  });
};

/**
 * Retrieves a piece of data previously associated with the window by calling
 * storeWindowData.
 * @param {number} outerWindowID  the ID of the window
 * @param {Function} callback  function to be called with the data.
 * @static
 */
RequestNotifier.retrieveWindowData = function(outerWindowID, callback)
{
  let id = ++windowDataMaxResponseID;
  windowDataCallbacks.set(id, callback);

  messageManager.broadcastAsyncMessage("AdblockPlus:RetrieveWindowData", {
    outerWindowID,
    responseID: id
  });
};

/**
 * Retrieves the statistics for a window.
 * @param {number} outerWindowID  the ID of the window
 * @param {Function} callback  the callback to be called with the resulting
 *                             object (object properties will be items, blocked,
 *                             whitelisted, hidden, filters) or null.
 */
RequestNotifier.getWindowStatistics = function(outerWindowID, callback)
{
  let id = ++windowStatsMaxResponseID;
  windowStatsCallbacks.set(id, callback);

  messageManager.broadcastAsyncMessage("AdblockPlus:RetrieveWindowStats", {
    responseID: id,
    outerWindowID
  });
}
