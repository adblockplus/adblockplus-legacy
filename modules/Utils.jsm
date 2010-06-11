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
 * @fileOverview Module containing a bunch of utility functions.
 */

var EXPORTED_SYMBOLS = ["Utils"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");

let sidebarParams = null;

/**
 * Provides a bunch of utility functions.
 * @class
 */
var Utils =
{
  /**
   * Returns the add-on ID used by Adblock Plus
   */
  get addonID()
  {
    return "{d10d0bf8-f5b5-c8b4-a8b2-2b9879e08c5d}";
  },

  /**
   * Returns the installed Adblock Plus version
   */
  get addonVersion()
  {
    let version = "{{VERSION}}";
    return (version[0] == "{" ? "99.9" : version);
  },

  /**
   * Returns the VCS revision used for this Adblock Plus build
   */
  get addonBuild()
  {
    let build = "{{BUILD}}";
    return (build[0] == "{" ? "" : build);
  },

  /**
   * Returns ID of the application
   */
  get appID()
  {
    let appInfo = Cc["@mozilla.org/xre/app-info;1"].getService(Ci.nsIXULAppInfo);
    let id = appInfo.ID;
    Utils.__defineGetter__("appID", function() id);
    return Utils.appID;
  },

  /**
   * Retrieves a string from global.properties string bundle, will throw if string isn't found.
   * 
   * @param {String} name  string name
   * @return {String}
   */
  getString: function(name)
  {
    let stringBundle = Cc["@mozilla.org/intl/stringbundle;1"]
                        .getService(Ci.nsIStringBundleService)
                        .createBundle("chrome://adblockplus/locale/global.properties");
    Utils.getString = function(name)
    {
      return stringBundle.GetStringFromName(name);
    }
    return Utils.getString(name);
  },

  /**
   * Shows an alert message like window.alert() but with a custom title.
   * 
   * @param {Window} parentWindow  parent window of the dialog (can be null)
   * @param {String} message  message to be displayed
   * @param {String} [title]  dialog title, default title will be used if omitted
   */
  alert: function(parentWindow, message, title)
  {
    if (!title)
      title = Utils.getString("default_dialog_title");
    Utils.promptService.alert(parentWindow, title, message);
  },

  /**
   * Asks the user for a confirmation like window.confirm() but with a custom title.
   * 
   * @param {Window} parentWindow  parent window of the dialog (can be null)
   * @param {String} message  message to be displayed
   * @param {String} [title]  dialog title, default title will be used if omitted
   * @return {Bool}
   */
  confirm: function(parentWindow, message, title)
  {
    if (!title)
      title = Utils.getString("default_dialog_title");
    return Utils.promptService.confirm(parentWindow, title, message);
  },

  /**
   * Retrieves the window for a document node.
   * @return {Window} will be null if the node isn't associated with a window
   */
  getWindow: function(/**Node*/ node)
  {
    if (node instanceof Ci.nsIDOMNode && node.ownerDocument)
      node = node.ownerDocument;
  
    if (node instanceof Ci.nsIDOMDocumentView)
      return node.defaultView;
  
    return null;
  },

  /**
   * If a protocol using nested URIs like jar: is used - retrieves innermost
   * nested URI.
   */
  unwrapURL: function(/**nsIURI or String*/ url) /**nsIURI*/
  {
    if (!(url instanceof Ci.nsIURI))
      url = Utils.makeURI(url);
  
    if (url instanceof Ci.nsINestedURI)
      return url.innermostURI;
    else
      return url;
  },

  /**
   * Translates a string URI into its nsIURI representation, will return null for
   * invalid URIs.
   */
  makeURI: function(/**String*/ url) /**nsIURI*/
  {
    try
    {
      return Utils.ioService.newURI(url, null, null);
    }
    catch (e) {
      return null;
    }
  },

  /**
   * Posts an action to the event queue of the current thread to run it
   * asynchronously. Any additional parameters to this function are passed
   * as parameters to the callback.
   */
  runAsync: function(/**Function*/ callback, /**Object*/ thisPtr)
  {
    let params = Array.prototype.slice.call(arguments, 2);
    let runnable = {
      run: function()
      {
        callback.apply(thisPtr, params);
      }
    };
    Utils.threadManager.currentThread.dispatch(runnable, Ci.nsIEventTarget.DISPATCH_NORMAL);
  },

  /**
   * Gets the DOM window associated with a particular request (if any).
   */
  getRequestWindow: function(/**nsIChannel*/ channel) /**nsIDOMWindow*/
  {
    let callbacks = [];
    if (channel.notificationCallbacks)
      callbacks.push(channel.notificationCallbacks);
    if (channel.loadGroup && channel.loadGroup.notificationCallbacks)
      callbacks.push(channel.loadGroup.notificationCallbacks);
  
    for each (let callback in callbacks)
    {
      try {
        // For Gecko 1.9.1
        return callback.getInterface(Ci.nsILoadContext).associatedWindow;
      } catch(e) {}
  
      try {
        // For Gecko 1.9.0
        return callback.getInterface(Ci.nsIDOMWindow);
      } catch(e) {}
    }
  
    return null;
  },

  /**
   * Retrieves the platform-dependent line break string.
   */
  getLineBreak: function()
  {
    // HACKHACK: Gecko doesn't expose NS_LINEBREAK, try to determine
    // plattform's line breaks by reading prefs.js
    let lineBreak = "\n";
    try {
      let prefFile = Utils.dirService.get("PrefF", Ci.nsIFile);
      let inputStream = Cc["@mozilla.org/network/file-input-stream;1"].createInstance(Ci.nsIFileInputStream);
      inputStream.init(prefFile, 0x01, 0444, 0);
  
      let scriptableStream = Cc["@mozilla.org/scriptableinputstream;1"].createInstance(Ci.nsIScriptableInputStream);
      scriptableStream.init(inputStream);
      let data = scriptableStream.read(1024);
      scriptableStream.close();
  
      if (/(\r\n?|\n\r?)/.test(data))
        lineBreak = RegExp.$1;
    } catch (e) {}
  
    Utils.getLineBreak = function() lineBreak;
    return lineBreak;
  },

  /**
   * Generates filter subscription checksum.
   *
   * @param {Array of String} lines filter subscription lines (with checksum line removed)
   * @return {String} checksum or null
   */
  generateChecksum: function(lines)
  {
    let stream = null;
    try
    {
      // Checksum is an MD5 checksum (base64-encoded without the trailing "=") of
      // all lines in UTF-8 without the checksum line, joined with "\n".
  
      let converter = Cc["@mozilla.org/intl/scriptableunicodeconverter"].createInstance(Ci.nsIScriptableUnicodeConverter);
      converter.charset = "UTF-8";
      stream = converter.convertToInputStream(lines.join("\n"));
  
      let hashEngine = Cc["@mozilla.org/security/hash;1"].createInstance(Ci.nsICryptoHash);
      hashEngine.init(hashEngine.MD5);
      hashEngine.updateFromStream(stream, stream.available());
      return hashEngine.finish(true).replace(/=+$/, "");
    }
    catch (e)
    {
      return null;
    }
    finally
    {
      if (stream)
        stream.close();
    }
  },

  /**
   * Opens preferences dialog or focused already open dialog.
   * @param {String} location  (optional) filter suggestion
   * @param {Filter} filter    (optional) filter to be selected
   */
  openSettingsDialog: function(location, filter)
  {
    var dlg = Utils.windowMediator.getMostRecentWindow("abp:settings");
    var func = function()
    {
      if (typeof location != "undefined")
        dlg.setLocation(location);
      if (typeof filter != "undefined")
        dlg.selectFilter(filter);
    }

    if (dlg)
    {
      func();

      try
      {
        dlg.focus();
      }
      catch (e) {}

      if (Utils.windowMediator.getMostRecentWindow(null) != dlg)
      {
        // There must be some modal dialog open
        dlg = Utils.windowMediator.getMostRecentWindow("abp:subscriptionSelection") || Utils.windowMediator.getMostRecentWindow("abp:about");
        if (dlg)
          dlg.focus();
      }
    }
    else
    {
      dlg = Utils.windowWatcher.openWindow(null, "chrome://adblockplus/content/ui/settings.xul", "_blank", "chrome,centerscreen,resizable,dialog=no", null);
      dlg.addEventListener("post-load", func, false);
    }
  },

  /**
   * Opens a URL in the browser window. If browser window isn't passed as parameter,
   * this function attempts to find a browser window. If an event is passed in
   * it should be passed in to the browser if possible (will e.g. open a tab in
   * background depending on modifiers keys).
   */
  loadInBrowser: function(/**String*/ url, /**Window*/ currentWindow, /**Event*/ event)
  {
    let abpHooks = currentWindow ? currentWindow.document.getElementById("abp-hooks") : null;
    if (!abpHooks || !abpHooks.addTab)
    {
      let enumerator = Utils.windowMediator.getZOrderDOMWindowEnumerator(null, true);
      while (enumerator.hasMoreElements())
      {
        let window = enumerator.getNext().QueryInterface(Ci.nsIDOMWindow);
        abpHooks = window.document.getElementById("abp-hooks");
        if (abpHooks && abpHooks.addTab)
          break;
      }
    }

    if (abpHooks && abpHooks.addTab)
      abpHooks.addTab(url, event);
    else
    {
      let protocolService = Cc["@mozilla.org/uriloader/external-protocol-service;1"].getService(Ci.nsIExternalProtocolService);
      protocolService.loadURI(Utils.makeURI(url), null);
    }
  },

  /**
   * Saves sidebar state before detaching/reattaching
   */
  setParams: function(params)
  {
    sidebarParams = params;
  },

  /**
   * Retrieves and removes sidebar state after detaching/reattaching
   */
  getParams: function()
  {
    let ret = sidebarParams;
    sidebarParams = null;
    return ret;
  }
};

// Getters for common services, this should be replaced by Services.jsm in future

XPCOMUtils.defineLazyServiceGetter(Utils, "categoryManager", "@mozilla.org/categorymanager;1", "nsICategoryManager");
XPCOMUtils.defineLazyServiceGetter(Utils, "ioService", "@mozilla.org/network/io-service;1", "nsIIOService");
XPCOMUtils.defineLazyServiceGetter(Utils, "dirService", "@mozilla.org/file/directory_service;1", "nsIProperties");
XPCOMUtils.defineLazyServiceGetter(Utils, "threadManager", "@mozilla.org/thread-manager;1", "nsIThreadManager");
XPCOMUtils.defineLazyServiceGetter(Utils, "promptService", "@mozilla.org/embedcomp/prompt-service;1", "nsIPromptService");
XPCOMUtils.defineLazyServiceGetter(Utils, "effectiveTLD", "@mozilla.org/network/effective-tld-service;1", "nsIEffectiveTLDService");
XPCOMUtils.defineLazyServiceGetter(Utils, "netUtils", "@mozilla.org/network/util;1", "nsINetUtil");
XPCOMUtils.defineLazyServiceGetter(Utils, "styleService", "@mozilla.org/content/style-sheet-service;1", "nsIStyleSheetService");
XPCOMUtils.defineLazyServiceGetter(Utils, "prefService", "@mozilla.org/preferences-service;1", "nsIPrefService");
XPCOMUtils.defineLazyServiceGetter(Utils, "versionComparator", "@mozilla.org/xpcom/version-comparator;1", "nsIVersionComparator");
XPCOMUtils.defineLazyServiceGetter(Utils, "windowMediator", "@mozilla.org/appshell/window-mediator;1", "nsIWindowMediator");
XPCOMUtils.defineLazyServiceGetter(Utils, "windowWatcher", "@mozilla.org/embedcomp/window-watcher;1", "nsIWindowWatcher");
XPCOMUtils.defineLazyServiceGetter(Utils, "chromeRegistry", "@mozilla.org/chrome/chrome-registry;1", "nsIChromeRegistry");

if ("@mozilla.org/messenger/headerparser;1" in Cc)
  XPCOMUtils.defineLazyServiceGetter(Utils, "headerParser", "@mozilla.org/messenger/headerparser;1", "nsIMsgHeaderParser");
else
  Utils.headerParser = null;
