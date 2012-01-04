/*
 * This Source Code is subject to the terms of the Mozilla Public License
 * version 2.0 (the "License"). You can obtain a copy of the License at
 * http://mozilla.org/MPL/2.0/.
 */

/**
 * @fileOverview FilterNotifier class manages listeners and distributes messages
 * about filter changes to them.
 */

var EXPORTED_SYMBOLS = ["FilterNotifier"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

/**
 * List of registered listeners
 * @type Array of function(action, item, newValue, oldValue)
 */
let listeners = [];

/**
 * This class allows registering and triggering listeners for filter events.
 * @class
 */
var FilterNotifier =
{
  /**
   * Adds a listener
   */
  addListener: function(/**function(action, item, newValue, oldValue)*/ listener)
  {
    if (listeners.indexOf(listener) >= 0)
      return;

    listeners.push(listener);
  },

  /**
   * Removes a listener that was previosly added via addListener
   */
  removeListener: function(/**function(action, item, newValue, oldValue)*/ listener)
  {
    let index = listeners.indexOf(listener);
    if (index >= 0)
      listeners.splice(index, 1);
  },

  /**
   * Notifies listeners about an event
   * @param {String} action event code ("load", "save", "elemhideupdate",
   *                 "subscription.added", "subscription.removed",
   *                 "subscription.disabled", "subscription.title",
   *                 "subscription.lastDownload", "subscription.downloadStatus",
   *                 "subscription.homepage", "subscription.updated",
   *                 "filter.added", "filter.removed", "filter.moved",
   *                 "filter.disabled", "filter.hitCount", "filter.lastHit")
   * @param {Subscription|Filter} item item that the change applies to
   */
  triggerListeners: function(action, item, param1, param2, param3)
  {
    for each (let listener in listeners)
      listener(action, item, param1, param2, param3);
  }
};
