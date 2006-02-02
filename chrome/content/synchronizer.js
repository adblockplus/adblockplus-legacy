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
 * Manages synchronization of filter subscriptions.
 * This file is included from nsAdblockPlus.js.
 */

var synchronizer = {
  executing: new HashTable(),
  listeners: [],
  timer: null,

  init: function() {
    var callback = function() {
      synchronizer.timer.delay = 3600000;

      for (var i = 0; i < prefs.grouporder.length; i++) {
        if (prefs.grouporder[i].indexOf("~") == 0)
          continue;
    
        var synchPrefs = prefs.synch.get(prefs.grouporder[i]);
        if (typeof synchPrefs == "undefined" || !synchPrefs.autodownload || synchPrefs.external)
          continue;
    
        // Get the number of hours since last download
        var interval = (new Date().getTime()/1000 - synchPrefs.lastsuccess) / 3600;
        if (interval > prefs.synchronizationinterval)
          synchronizer.execute(synchPrefs);
      }
    }

    this.timer = createTimer(callback, 300000);
    this.timer.type = this.timer.TYPE_REPEATING_SLACK;
  },

  // Adds a new handler to be notified whenever synchronization status changes
  addListener: function(handler) {
    this.listeners.push(handler);
  },
  
  // Removes a handler
  removeListener: function(handler) {
    for (var i = 0; i < this.listeners.length; i++)
      if (this.listeners[i] == handler)
        this.listeners.splice(i--, 1);
  },

  // Calls all listeners
  notifyListeners: function(synchPrefs, status) {
    for (var i = 0; i < this.listeners.length; i++)
      this.listeners[i](synchPrefs, status);
  },

  isExecuting: function(url) {
    return this.executing.has(url);
  },

  readPatterns: function(synchPrefs, text) {
    var lines = text.split(/[\r\n]+/);
    for (var i = 0; i < lines.length; i++) {
      lines[i] = lines[i].replace(/\s/g, "");
      if (!lines[i])
        lines.splice(i--, 1);
    }
    if (!/\[Adblock\]/i.test(lines[0])) {
      this.setError(synchPrefs, "synchronize_invalid_data");
      return;
    }

    lines.shift(0);
    synchPrefs.lastdownload = synchPrefs.lastsuccess = new Date().getTime() / 1000;
    synchPrefs.downloadstatus = "synchronize_ok";
    synchPrefs.patterns = lines;
    prefs.save();
    this.notifyListeners(synchPrefs, "ok");
  },

  setError: function(synchPrefs, error) {
    this.executing.remove(synchPrefs.url);
    synchPrefs.lastdownload = new Date().getTime() / 1000;
    synchPrefs.downloadstatus = error;
    prefs.save();
    this.notifyListeners(synchPrefs, "error");
  },

  execute: function(synchPrefs) {
    var url = synchPrefs.url;
    if (this.executing.has(url))
      return;

    try {
      var request = Components.classes["@mozilla.org/xmlextras/xmlhttprequest;1"]
                              .createInstance(Components.interfaces.nsIJSXMLHttpRequest);
      request.open("GET", url);
      request.channel.loadFlags = request.channel.loadFlags |
                                  request.channel.INHIBIT_CACHING |
                                  request.channel.LOAD_BYPASS_CACHE;
    }
    catch (e) {
      this.setError(synchPrefs, "synchronize_invalid_url");
      return;
    }

    request.onerror = function() {
      if (!prefs.synch.has(url))
        return;

      synchronizer.setError(prefs.synch.get(url), "synchronize_connection_error");
    };

    request.onload = function() {
      synchronizer.executing.remove(url);
      if (prefs.synch.has(url))
        synchronizer.readPatterns(prefs.synch.get(url), request.responseText);
    };

    this.executing.put(url, request);
    this.notifyListeners(synchPrefs, "executing");

    try {
      request.send(null);
    }
    catch (e) {
      this.setError(synchPrefs, "synchronize_connection_error");
      return;
    }
  }
};

synchronizer.init();
abp.synchronizer = synchronizer;
