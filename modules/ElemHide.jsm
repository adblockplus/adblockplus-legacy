/*
 * This Source Code is subject to the terms of the Mozilla Public License
 * version 2.0 (the "License"). You can obtain a copy of the License at
 * http://mozilla.org/MPL/2.0/.
 */

/**
 * @fileOverview Element hiding implementation.
 */

var EXPORTED_SYMBOLS = ["ElemHide"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

let baseURL = "chrome://adblockplus-modules/content/";
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import(baseURL + "Utils.jsm");
Cu.import(baseURL + "IO.jsm");
Cu.import(baseURL + "Prefs.jsm");
Cu.import(baseURL + "ContentPolicy.jsm");
Cu.import(baseURL + "FilterNotifier.jsm");
Cu.import(baseURL + "FilterClasses.jsm");
Cu.import(baseURL + "TimeLine.jsm");

/**
 * Lookup table, filters by their associated key
 * @type Object
 */
let filterByKey = {__proto__: null};

/**
 * Lookup table, keys of the filters by filter text
 * @type Object
 */
let keyByFilter = {__proto__: null};

/**
 * Currently applied stylesheet URL
 * @type nsIURI
 */
let styleURL = null;

/**
 * Element hiding component
 * @class
 */
var ElemHide =
{
  /**
   * Indicates whether filters have been added or removed since the last apply() call.
   * @type Boolean
   */
  isDirty: false,

  /**
   * Inidicates whether the element hiding stylesheet is currently applied.
   * @type Boolean
   */
  applied: false,

  /**
   * Called on module startup.
   */
  init: function()
  {
    TimeLine.enter("Entered ElemHide.init()");
    Prefs.addListener(function(name)
    {
      if (name == "enabled")
        ElemHide.apply();
    });
  
    TimeLine.log("done adding prefs listener");

    let styleFile = IO.resolveFilePath(Prefs.data_directory);
    styleFile.append("elemhide.css");
    styleURL = Utils.ioService.newFileURI(styleFile).QueryInterface(Ci.nsIFileURL);
    TimeLine.log("done determining stylesheet URL");

    TimeLine.log("registering component");
    let registrar = Components.manager.QueryInterface(Ci.nsIComponentRegistrar);
    registrar.registerFactory(ElemHidePrivate.classID, ElemHidePrivate.classDescription,
        "@mozilla.org/network/protocol/about;1?what=" + ElemHidePrivate.aboutPrefix, ElemHidePrivate);

    TimeLine.leave("ElemHide.init() done");
  },

  /**
   * Removes all known filters
   */
  clear: function()
  {
    filterByKey = {__proto__: null};
    keyByFilter = {__proto__: null};
    ElemHide.isDirty = false;
    ElemHide.unapply();
  },

  /**
   * Add a new element hiding filter
   * @param {ElemHideFilter} filter
   */
  add: function(filter)
  {
    if (filter.text in keyByFilter)
      return;

    let key;
    do {
      key = Math.random().toFixed(15).substr(5);
    } while (key in filterByKey);

    filterByKey[key] = filter;
    keyByFilter[filter.text] = key;
    ElemHide.isDirty = true;
  },

  /**
   * Removes an element hiding filter
   * @param {ElemHideFilter} filter
   */
  remove: function(filter)
  {
    if (!(filter.text in keyByFilter))
      return;

    let key = keyByFilter[filter.text];
    delete filterByKey[key];
    delete keyByFilter[filter.text];
    ElemHide.isDirty = true;
  },

  /**
   * Will be set to true if apply() is running (reentrance protection).
   * @type Boolean
   */
  _applying: false,

  /**
   * Will be set to true if an apply() call arrives while apply() is already
   * running (delayed execution).
   * @type Boolean
   */
  _needsApply: false,

  /**
   * Generates stylesheet URL and applies it globally
   */
  apply: function()
  {
    if (this._applying)
    {
      this._needsApply = true;
      return;
    }

    TimeLine.enter("Entered ElemHide.apply()");

    if (!ElemHide.isDirty || !Prefs.enabled)
    {
      // Nothing changed, looks like we merely got enabled/disabled
      if (Prefs.enabled && !ElemHide.applied)
      {
        try
        {
          Utils.styleService.loadAndRegisterSheet(styleURL, Ci.nsIStyleSheetService.USER_SHEET);
          ElemHide.applied = true;
        }
        catch (e)
        {
          Cu.reportError(e);
        }
        TimeLine.log("Applying existing stylesheet finished");
      }
      else if (!Prefs.enabled && ElemHide.applied)
      {
        ElemHide.unapply();
        TimeLine.log("ElemHide.unapply() finished");
      }

      TimeLine.leave("ElemHide.apply() done (no file changes)");
      return;
    }

    IO.writeToFile(styleURL.file, false, this._generateCSSContent(), function(e)
    {
      TimeLine.enter("ElemHide.apply() write callback");
      this._applying = false;

      if (e && e.result == Cr.NS_ERROR_NOT_AVAILABLE)
      {
        e = null;
        try
        {
          styleURL.file.remove(false);
        } catch (e2) {}
      }
      else if (e)
        Cu.reportError(e);

      if (this._needsApply)
      {
        this._needsApply = false;
        this.apply();
      }
      else if (!e)
      {
        ElemHide.isDirty = false;

        ElemHide.unapply();
        TimeLine.log("ElemHide.unapply() finished");

        if (styleURL.file.exists())
        {
          try
          {
            Utils.styleService.loadAndRegisterSheet(styleURL, Ci.nsIStyleSheetService.USER_SHEET);
            ElemHide.applied = true;
          }
          catch (e)
          {
            Cu.reportError(e);
          }
          TimeLine.log("Applying stylesheet finished");
        }

        FilterNotifier.triggerListeners("elemhideupdate");
      }
      TimeLine.leave("ElemHide.apply() write callback done");
    }.bind(this), "ElemHideWrite");

    this._applying = true;

    TimeLine.leave("ElemHide.apply() done", "ElemHideWrite");
  },

  _generateCSSContent: function()
  {
    // Grouping selectors by domains
    TimeLine.log("start grouping selectors");
    let domains = {__proto__: null};
    let hasFilters = false;
    for (let key in filterByKey)
    {
      let filter = filterByKey[key];
      let domain = filter.selectorDomain || "";

      let list;
      if (domain in domains)
        list = domains[domain];
      else
      {
        list = {__proto__: null};
        domains[domain] = list;
      }
      list[filter.selector] = key;
      hasFilters = true;
    }
    TimeLine.log("done grouping selectors");

    if (!hasFilters)
      throw Cr.NS_ERROR_NOT_AVAILABLE;

    function escapeChar(match)
    {
      return "\\" + match.charCodeAt(0).toString(16) + " ";
    }

    // Return CSS data
    let cssTemplate = "-moz-binding: url(about:" + ElemHidePrivate.aboutPrefix + "?%ID%#dummy) !important;";
    for (let domain in domains)
    {
      let rules = [];
      let list = domains[domain];

      if (domain)
        yield ('@-moz-document domain("' + domain.split(",").join('"),domain("') + '"){').replace(/[^\x01-\x7F]/g, escapeChar);
      else
      {
        // Only allow unqualified rules on a few protocols to prevent them from blocking chrome
        yield '@-moz-document url-prefix("http://"),url-prefix("https://"),'
                  + 'url-prefix("mailbox://"),url-prefix("imap://"),'
                  + 'url-prefix("news://"),url-prefix("snews://"){';
      }

      for (let selector in list)
        yield selector.replace(/[^\x01-\x7F]/g, escapeChar) + "{" + cssTemplate.replace("%ID%", list[selector]) + "}";
      yield '}';
    }
  },

  /**
   * Unapplies current stylesheet URL
   */
  unapply: function()
  {
    if (ElemHide.applied)
    {
      try
      {
        Utils.styleService.unregisterSheet(styleURL, Ci.nsIStyleSheetService.USER_SHEET);
      }
      catch (e)
      {
        Cu.reportError(e);
      }
      ElemHide.applied = false;
    }
  },

  /**
   * Retrieves the currently applied stylesheet URL
   * @type String
   */
  get styleURL() ElemHide.applied ? styleURL.spec : null,

  /**
   * Retrieves an element hiding filter by the corresponding protocol key
   */
  getFilterByKey: function(/**String*/ key) /**Filter*/
  {
    return (key in filterByKey ? filterByKey[key] : null);
  }
};

/**
 * Private nsIAboutModule implementation
 * @class
 */
var ElemHidePrivate =
{
  classID: Components.ID("{55fb7be0-1dd2-11b2-98e6-9e97caf8ba67}"),
  classDescription: "Element hiding hit registration protocol handler",
  aboutPrefix: "abp-elemhidehit",

  //
  // Factory implementation
  //

  createInstance: function(outer, iid)
  {
    if (outer != null)
      throw Cr.NS_ERROR_NO_AGGREGATION;

    return this.QueryInterface(iid);
  },

  //
  // About module implementation
  //

  getURIFlags: function(uri)
  {
    return ("HIDE_FROM_ABOUTABOUT" in Ci.nsIAboutModule ? Ci.nsIAboutModule.HIDE_FROM_ABOUTABOUT : 0);
  },

  newChannel: function(uri)
  {
    let match = /\?(\d+)/.exec(uri.path)
    if (!match)
      throw Cr.NS_ERROR_FAILURE;

    return new HitRegistrationChannel(uri, match[1]);
  },

  QueryInterface: XPCOMUtils.generateQI([Ci.nsIFactory, Ci.nsIAboutModule])
};

/**
 * Channel returning data for element hiding hits.
 * @constructor
 */
function HitRegistrationChannel(uri, key)
{
  this.key = key;
  this.URI = this.originalURI = uri;
}
HitRegistrationChannel.prototype = {
  key: null,
  URI: null,
  originalURI: null,
  contentCharset: "utf-8",
  contentLength: 0,
  contentType: "text/xml",
  owner: Utils.systemPrincipal,
  securityInfo: null,
  notificationCallbacks: null,
  loadFlags: 0,
  loadGroup: null,
  name: null,
  status: Cr.NS_OK,

  asyncOpen: function(listener, context)
  {
    let stream = this.open();
    Utils.runAsync(function()
    {
      try {
        listener.onStartRequest(this, context);
      } catch(e) {}
      try {
        listener.onDataAvailable(this, context, stream, 0, stream.available());
      } catch(e) {}
      try {
        listener.onStopRequest(this, context, Cr.NS_OK);
      } catch(e) {}
    }, this);
  },

  open: function()
  {
    let data = "<bindings xmlns='http://www.mozilla.org/xbl'><binding id='dummy'/></bindings>";
    if (this.key in filterByKey)
    {
      let wnd = Utils.getRequestWindow(this);
      if (wnd && wnd.document && !Policy.processNode(wnd, wnd.document, Policy.type.ELEMHIDE, filterByKey[this.key]))
        data = "<bindings xmlns='http://www.mozilla.org/xbl'/>";
    }

    let stream = Cc["@mozilla.org/io/string-input-stream;1"].createInstance(Ci.nsIStringInputStream);
    stream.setData(data, data.length);
    return stream;
  },
  isPending: function()
  {
    return false;
  },
  cancel: function()
  {
    throw Cr.NS_ERROR_NOT_IMPLEMENTED;
  },
  suspend: function()
  {
    throw Cr.NS_ERROR_NOT_IMPLEMENTED;
  },
  resume: function()
  {
    throw Cr.NS_ERROR_NOT_IMPLEMENTED;
  },

  QueryInterface: XPCOMUtils.generateQI([Ci.nsIChannel, Ci.nsIRequest])
};
