/*
 * This Source Code is subject to the terms of the Mozilla Public License
 * version 2.0 (the "License"). You can obtain a copy of the License at
 * http://mozilla.org/MPL/2.0/.
 */

/**
 * @fileOverview Module containing a bunch of utility functions.
 */

var EXPORTED_SYMBOLS = ["Utils", "Cache"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/FileUtils.jsm");
Cu.import("resource://gre/modules/NetUtil.jsm");
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
    let id = Services.appinfo.ID;
    Utils.__defineGetter__("appID", function() id);
    return Utils.appID;
  },

  /**
   * Returns whether we are running in Fennec, for Fennec-specific hacks
   * @type Boolean
   */
  get isFennec()
  {
    let result = (this.appID == "{a23983c0-fd0e-11dc-95ff-0800200c9a66}" || this.appID == "{aa3c5121-dab2-40e2-81ca-7ea25febc110}");
    Utils.__defineGetter__("isFennec", function() result);
    return result;
  },

  /**
   * Returns the user interface locale selected for adblockplus chrome package.
   */
  get appLocale()
  {
    let locale = "en-US";
    try
    {
      locale = Utils.chromeRegistry.getSelectedLocale("adblockplus");
    }
    catch (e)
    {
      Cu.reportError(e);
    }
    Utils.__defineGetter__("appLocale", function() locale);
    return Utils.appLocale;
  },

  /**
   * Returns version of the Gecko platform
   */
  get platformVersion()
  {
    let platformVersion = Services.appinfo.platformVersion;
    Utils.__defineGetter__("platformVersion", function() platformVersion);
    return Utils.platformVersion;
  },

  /**
   * Retrieves a string from global.properties string bundle, will throw if string isn't found.
   * 
   * @param {String} name  string name
   * @return {String}
   */
  getString: function(name)
  {
    let stringBundle = Services.strings.createBundle("chrome://adblockplus/locale/global.properties");
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
    if ("ownerDocument" in node && node.ownerDocument)
      node = node.ownerDocument;
  
    if ("defaultView" in node)
      return node.defaultView;
  
    return null;
  },

  /**
   * If the window doesn't have its own security context (e.g. about:blank or
   * data: URL) walks up the parent chain until a window is found that has a
   * security context.
   */
  getOriginWindow: function(/**Window*/ wnd) /**Window*/
  {
    while (wnd != wnd.parent)
    {
      let uri = Utils.makeURI(wnd.location.href);
      if (uri.spec != "about:blank" && uri.spec != "moz-safe-about:blank" &&
          !Utils.netUtils.URIChainHasFlags(uri, Ci.nsIProtocolHandler.URI_INHERITS_SECURITY_CONTEXT))
      {
        break;
      }
      wnd = wnd.parent;
    }
    return wnd;
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
    try
    {
      if (channel.notificationCallbacks)
        return channel.notificationCallbacks.getInterface(Ci.nsILoadContext).associatedWindow;
    } catch(e) {}
  
    try
    {
      if (channel.loadGroup && channel.loadGroup.notificationCallbacks)
        return channel.loadGroup.notificationCallbacks.getInterface(Ci.nsILoadContext).associatedWindow;
    } catch(e) {}

    return null;
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
   * Opens filter preferences dialog or focuses an already open dialog.
   * @param {Filter} [filter]  filter to be selected
   */
  openFiltersDialog: function(filter)
  {
    var dlg = Utils.windowMediator.getMostRecentWindow("abp:filters");
    if (dlg)
    {
      try
      {
        dlg.focus();
      }
      catch (e) {}
      if (filter)
        dlg.SubscriptionActions.selectFilter(filter);
    }
    else
    {
      Utils.windowWatcher.openWindow(null, "chrome://adblockplus/content/ui/filters.xul", "_blank", "chrome,centerscreen,resizable,dialog=no", {wrappedJSObject: filter});
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
      if (!enumerator.hasMoreElements())
      {
        // On Linux the list returned will be empty, see bug 156333. Fall back to random order.
        enumerator = Utils.windowMediator.getEnumerator(null);
      }
      while (enumerator.hasMoreElements())
      {
        let window = enumerator.getNext().QueryInterface(Ci.nsIDOMWindow);
        abpHooks = window.document.getElementById("abp-hooks");
        if (abpHooks && abpHooks.addTab)
        {
          if (!currentWindow)
            window.focus();
          break;
        }
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
   * Opens a pre-defined documentation link in the browser window. This will
   * send the UI language to adblockplus.org so that the correct language
   * version of the page can be selected.
   */
  loadDocLink: function(/**String*/ linkID)
  {
    let baseURL = "chrome://adblockplus-modules/content/";
    Cu.import(baseURL + "Prefs.jsm");

    let link = Prefs.documentation_link.replace(/%LINK%/g, linkID).replace(/%LANG%/g, Utils.appLocale);
    Utils.loadInBrowser(link);
  },

  /**
   * Formats a unix time according to user's locale.
   * @param {Integer} time  unix time in milliseconds
   * @return {String} formatted date and time
   */
  formatTime: function(time)
  {
    try
    {
      let date = new Date(time);
      return Utils.dateFormatter.FormatDateTime("", Ci.nsIScriptableDateFormat.dateFormatShort,
                                                Ci.nsIScriptableDateFormat.timeFormatNoSeconds,
                                                date.getFullYear(), date.getMonth() + 1, date.getDate(),
                                                date.getHours(), date.getMinutes(), date.getSeconds());
    }
    catch(e)
    {
      // Make sure to return even on errors
      Cu.reportError(e);
      return "";
    }
  },

  /**
   * Checks whether any of the prefixes listed match the application locale,
   * returns matching prefix if any.
   */
  checkLocalePrefixMatch: function(/**String*/ prefixes) /**String*/
  {
    if (!prefixes)
      return null;

    let appLocale = Utils.appLocale;
    for each (let prefix in prefixes.split(/,/))
      if (new RegExp("^" + prefix + "\\b").test(appLocale))
        return prefix;

    return null;
  },

  /**
   * Chooses the best filter subscription for user's language.
   */
  chooseFilterSubscription: function(/**NodeList*/ subscriptions) /**Node*/
  {
    let selectedItem = null;
    let selectedPrefix = null;
    let matchCount = 0;
    for (let i = 0; i < subscriptions.length; i++)
    {
      let subscription = subscriptions[i];
      if (!selectedItem)
        selectedItem = subscription;

      let prefix = Utils.checkLocalePrefixMatch(subscription.getAttribute("prefixes"));
      if (prefix)
      {
        if (!selectedPrefix || selectedPrefix.length < prefix.length)
        {
          selectedItem = subscription;
          selectedPrefix = prefix;
          matchCount = 1;
        }
        else if (selectedPrefix && selectedPrefix.length == prefix.length)
        {
          matchCount++;

          // If multiple items have a matching prefix of the same length:
          // Select one of the items randomly, probability should be the same
          // for all items. So we replace the previous match here with
          // probability 1/N (N being the number of matches).
          if (Math.random() * matchCount < 1)
          {
            selectedItem = subscription;
            selectedPrefix = prefix;
          }
        }
      }
    }
    return selectedItem;
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
  },

  /**
   * Randomly generated class for collapsed nodes.
   * @type String
   */
  collapsedClass: null,

  /**
   * Nodes scheduled for post-processing (might be null).
   * @type Array of Node
   */
  scheduledNodes: null,

  /**
   * Schedules a node for post-processing.
   */
  schedulePostProcess: function(node)
  {
    if (Utils.scheduledNodes)
      Utils.scheduledNodes.push(node);
    else
    {
      Utils.scheduledNodes = [node];
      Utils.runAsync(Utils.postProcessNodes);
    }
  },

  /**
   * Processes nodes scheduled for post-processing (typically hides them).
   */
  postProcessNodes: function()
  {
    let nodes = Utils.scheduledNodes;
    Utils.scheduledNodes = null;

    for each (let node in nodes)
    {
      // adjust frameset's cols/rows for frames
      let parentNode = node.parentNode;
      if (parentNode && parentNode instanceof Ci.nsIDOMHTMLFrameSetElement)
      {
        let hasCols = (parentNode.cols && parentNode.cols.indexOf(",") > 0);
        let hasRows = (parentNode.rows && parentNode.rows.indexOf(",") > 0);
        if ((hasCols || hasRows) && !(hasCols && hasRows))
        {
          let index = -1;
          for (let frame = node; frame; frame = frame.previousSibling)
            if (frame instanceof Ci.nsIDOMHTMLFrameElement || frame instanceof Ci.nsIDOMHTMLFrameSetElement)
              index++;

          let property = (hasCols ? "cols" : "rows");
          let weights = parentNode[property].split(",");
          weights[index] = "0";
          parentNode[property] = weights.join(",");
        }
      }
      else
        node.className += " " + Utils.collapsedClass;
    }
  },

  /**
   * Verifies RSA signature. The public key and signature should be base64-encoded.
   */
  verifySignature: function(/**String*/ key, /**String*/ signature, /**String*/ data) /**Boolean*/
  {
    if (!Utils.crypto)
      return false;

    // Maybe we did the same check recently, look it up in the cache
    if (!("_cache" in Utils.verifySignature))
      Utils.verifySignature._cache = new Cache(5);
    let cache = Utils.verifySignature._cache;
    let cacheKey = key + " " + signature + " " + data;
    if (cacheKey in cache.data)
      return cache.data[cacheKey];
    else
      cache.add(cacheKey, false);

    let keyInfo, pubKey, context;
    try
    {
      let keyItem = Utils.crypto.getSECItem(atob(key));
      keyInfo = Utils.crypto.SECKEY_DecodeDERSubjectPublicKeyInfo(keyItem.address());
      if (keyInfo.isNull())
        throw new Error("SECKEY_DecodeDERSubjectPublicKeyInfo failed");

      pubKey = Utils.crypto.SECKEY_ExtractPublicKey(keyInfo);
      if (pubKey.isNull())
        throw new Error("SECKEY_ExtractPublicKey failed");

      let signatureItem = Utils.crypto.getSECItem(atob(signature));

      context = Utils.crypto.VFY_CreateContext(pubKey, signatureItem.address(), Utils.crypto.SEC_OID_ISO_SHA_WITH_RSA_SIGNATURE, null);
      if (context.isNull())
        return false;   // This could happen if the signature is invalid

      let error = Utils.crypto.VFY_Begin(context);
      if (error < 0)
        throw new Error("VFY_Begin failed");

      error = Utils.crypto.VFY_Update(context, data, data.length);
      if (error < 0)
        throw new Error("VFY_Update failed");

      error = Utils.crypto.VFY_End(context);
      if (error < 0)
        return false;

      cache.data[cacheKey] = true;
      return true;
    }
    catch (e)
    {
      Cu.reportError(e);
      return false;
    }
    finally
    {
      if (keyInfo && !keyInfo.isNull())
        Utils.crypto.SECKEY_DestroySubjectPublicKeyInfo(keyInfo);
      if (pubKey && !pubKey.isNull())
        Utils.crypto.SECKEY_DestroyPublicKey(pubKey);
      if (context && !context.isNull())
        Utils.crypto.VFY_DestroyContext(context, true);
    }
  }
};

/**
 * A cache with a fixed capacity, newer entries replace entries that have been
 * stored first.
 * @constructor
 */
function Cache(/**Integer*/ size)
{
  this._ringBuffer = new Array(size);
  this.data = {__proto__: null};
}
Cache.prototype =
{
  /**
   * Ring buffer storing hash keys, allows determining which keys need to be
   * evicted.
   * @type Array
   */
  _ringBuffer: null,

  /**
   * Index in the ring buffer to be written next.
   * @type Integer
   */
  _bufferIndex: 0,

  /**
   * Cache data, maps values to the keys. Read-only access, for writing use
   * add() method.
   * @type Object
   */
  data: null,

  /**
   * Adds a key and the corresponding value to the cache.
   */
  add: function(/**String*/ key, value)
  {
    if (!(key in this.data))
    {
      // This is a new key - we need to add it to the ring buffer and evict
      // another entry instead.
      let oldKey = this._ringBuffer[this._bufferIndex];
      if (typeof oldKey != "undefined")
        delete this.data[oldKey];
      this._ringBuffer[this._bufferIndex] = key;

      this._bufferIndex++;
      if (this._bufferIndex >= this._ringBuffer.length)
        this._bufferIndex = 0;
    }

    this.data[key] = value;
  },

  /**
   * Clears cache contents.
   */
  clear: function()
  {
    this._ringBuffer = new Array(this._ringBuffer.length);
    this.data = {__proto__: null};
  }
}

// Getters for common services, this should be replaced by Services.jsm in future

XPCOMUtils.defineLazyServiceGetter(Utils, "categoryManager", "@mozilla.org/categorymanager;1", "nsICategoryManager");
XPCOMUtils.defineLazyServiceGetter(Utils, "ioService", "@mozilla.org/network/io-service;1", "nsIIOService");
XPCOMUtils.defineLazyServiceGetter(Utils, "threadManager", "@mozilla.org/thread-manager;1", "nsIThreadManager");
XPCOMUtils.defineLazyServiceGetter(Utils, "promptService", "@mozilla.org/embedcomp/prompt-service;1", "nsIPromptService");
XPCOMUtils.defineLazyServiceGetter(Utils, "effectiveTLD", "@mozilla.org/network/effective-tld-service;1", "nsIEffectiveTLDService");
XPCOMUtils.defineLazyServiceGetter(Utils, "netUtils", "@mozilla.org/network/util;1", "nsINetUtil");
XPCOMUtils.defineLazyServiceGetter(Utils, "styleService", "@mozilla.org/content/style-sheet-service;1", "nsIStyleSheetService");
XPCOMUtils.defineLazyServiceGetter(Utils, "prefService", "@mozilla.org/preferences-service;1", "nsIPrefService");
XPCOMUtils.defineLazyServiceGetter(Utils, "versionComparator", "@mozilla.org/xpcom/version-comparator;1", "nsIVersionComparator");
XPCOMUtils.defineLazyServiceGetter(Utils, "windowMediator", "@mozilla.org/appshell/window-mediator;1", "nsIWindowMediator");
XPCOMUtils.defineLazyServiceGetter(Utils, "windowWatcher", "@mozilla.org/embedcomp/window-watcher;1", "nsIWindowWatcher");
XPCOMUtils.defineLazyServiceGetter(Utils, "chromeRegistry", "@mozilla.org/chrome/chrome-registry;1", "nsIXULChromeRegistry");
XPCOMUtils.defineLazyServiceGetter(Utils, "systemPrincipal", "@mozilla.org/systemprincipal;1", "nsIPrincipal");
XPCOMUtils.defineLazyServiceGetter(Utils, "dateFormatter", "@mozilla.org/intl/scriptabledateformat;1", "nsIScriptableDateFormat");
XPCOMUtils.defineLazyServiceGetter(Utils, "childMessageManager", "@mozilla.org/childprocessmessagemanager;1", "nsISyncMessageSender");
XPCOMUtils.defineLazyServiceGetter(Utils, "parentMessageManager", "@mozilla.org/parentprocessmessagemanager;1", "nsIFrameMessageManager");
XPCOMUtils.defineLazyServiceGetter(Utils, "httpProtocol", "@mozilla.org/network/protocol;1?name=http", "nsIHttpProtocolHandler");
XPCOMUtils.defineLazyServiceGetter(Utils, "clipboard", "@mozilla.org/widget/clipboard;1", "nsIClipboard");
XPCOMUtils.defineLazyServiceGetter(Utils, "clipboardHelper", "@mozilla.org/widget/clipboardhelper;1", "nsIClipboardHelper");
XPCOMUtils.defineLazyGetter(Utils, "crypto", function()
{
  try
  {
    let ctypes = Components.utils.import("resource://gre/modules/ctypes.jsm", null).ctypes;

    let nsslib = ctypes.open(ctypes.libraryName("nss3"));

    let result = {};

    // seccomon.h
    result.siUTF8String = 14;

    // secoidt.h
    result.SEC_OID_ISO_SHA_WITH_RSA_SIGNATURE = 15;

    // The following types are opaque to us
    result.VFYContext = ctypes.void_t;
    result.SECKEYPublicKey = ctypes.void_t;
    result.CERTSubjectPublicKeyInfo = ctypes.void_t;

    /*
     * seccomon.h
     * struct SECItemStr {
     *   SECItemType type;
     *   unsigned char *data;
     *   unsigned int len;
     * };
     */
    result.SECItem = ctypes.StructType("SECItem", [
      {type: ctypes.int},
      {data: ctypes.unsigned_char.ptr},
      {len: ctypes.int}
    ]);

    /*
     * cryptohi.h
     * extern VFYContext *VFY_CreateContext(SECKEYPublicKey *key, SECItem *sig,
     *                                      SECOidTag sigAlg, void *wincx);
     */
    result.VFY_CreateContext = nsslib.declare(
      "VFY_CreateContext",
      ctypes.default_abi, result.VFYContext.ptr,
      result.SECKEYPublicKey.ptr,
      result.SECItem.ptr,
      ctypes.int,
      ctypes.voidptr_t
    );

    /*
     * cryptohi.h
     * extern void VFY_DestroyContext(VFYContext *cx, PRBool freeit);
     */
    result.VFY_DestroyContext = nsslib.declare(
      "VFY_DestroyContext",
      ctypes.default_abi, ctypes.void_t,
      result.VFYContext.ptr,
      ctypes.bool
    );

    /*
     * cryptohi.h
     * extern SECStatus VFY_Begin(VFYContext *cx);
     */
    result.VFY_Begin = nsslib.declare("VFY_Begin",
      ctypes.default_abi, ctypes.int,
      result.VFYContext.ptr
    );

    /*
     * cryptohi.h
     * extern SECStatus VFY_Update(VFYContext *cx, const unsigned char *input,
     *                             unsigned int inputLen);
     */
    result.VFY_Update = nsslib.declare(
      "VFY_Update",
      ctypes.default_abi, ctypes.int,
      result.VFYContext.ptr,
      ctypes.unsigned_char.ptr,
      ctypes.int
    );

    /*
     * cryptohi.h
     * extern SECStatus VFY_End(VFYContext *cx);
     */
    result.VFY_End = nsslib.declare(
      "VFY_End",
      ctypes.default_abi, ctypes.int,
      result.VFYContext.ptr
    );

    /*
     * keyhi.h
     * extern CERTSubjectPublicKeyInfo *
     * SECKEY_DecodeDERSubjectPublicKeyInfo(SECItem *spkider);
     */
    result.SECKEY_DecodeDERSubjectPublicKeyInfo = nsslib.declare(
      "SECKEY_DecodeDERSubjectPublicKeyInfo",
      ctypes.default_abi, result.CERTSubjectPublicKeyInfo.ptr,
      result.SECItem.ptr
    );

    /*
     * keyhi.h
     * extern void SECKEY_DestroySubjectPublicKeyInfo(CERTSubjectPublicKeyInfo *spki);
     */
    result.SECKEY_DestroySubjectPublicKeyInfo = nsslib.declare(
      "SECKEY_DestroySubjectPublicKeyInfo",
      ctypes.default_abi, ctypes.void_t,
      result.CERTSubjectPublicKeyInfo.ptr
    );

    /*
     * keyhi.h
     * extern SECKEYPublicKey *
     * SECKEY_ExtractPublicKey(CERTSubjectPublicKeyInfo *);
     */
    result.SECKEY_ExtractPublicKey = nsslib.declare(
      "SECKEY_ExtractPublicKey",
      ctypes.default_abi, result.SECKEYPublicKey.ptr,
      result.CERTSubjectPublicKeyInfo.ptr
    );

    /*
     * keyhi.h
     * extern void SECKEY_DestroyPublicKey(SECKEYPublicKey *key);
     */
    result.SECKEY_DestroyPublicKey = nsslib.declare(
      "SECKEY_DestroyPublicKey",
      ctypes.default_abi, ctypes.void_t,
      result.SECKEYPublicKey.ptr
    );

    // Convenience method
    result.getSECItem = function(data)
    {
      var dataArray = new ctypes.ArrayType(ctypes.unsigned_char, data.length)();
      for (let i = 0; i < data.length; i++)
        dataArray[i] = data.charCodeAt(i) % 256;
      return new result.SECItem(result.siUTF8String, dataArray, dataArray.length);
    };

    return result;
  }
  catch (e)
  {
    Cu.reportError(e);
    // Expected, ctypes isn't supported in Gecko 1.9.2
    return null;
  }
});

if ("@mozilla.org/messenger/headerparser;1" in Cc)
  XPCOMUtils.defineLazyServiceGetter(Utils, "headerParser", "@mozilla.org/messenger/headerparser;1", "nsIMsgHeaderParser");
else
  Utils.headerParser = null;
