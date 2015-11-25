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
  }
};

RequestNotifier.storeSelection = function(/**Window*/ wnd, /**String*/ selection)
{
  windowSelection.set(wnd.document, selection);
};
RequestNotifier.getSelection = function(/**Window*/ wnd) /**String*/
{
  if (windowSelection.has(wnd.document))
    return windowSelection.get(wnd.document);
  else
    return null;
};

/**
 * Retrieves the statistics for a window.
 * @result {Object} Object with the properties items, blocked, whitelisted, hidden, filters containing statistics for the window (might be null)
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
