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
 * Portions created by the Initial Developer are Copyright (C) 2006-2007
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * ***** END LICENSE BLOCK ***** */

var EXPORTED_SYMBOLS = [];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");

// Gecko 1.9.0/1.9.1 compatibility - add XPCOMUtils.defineLazyServiceGetter
if (!("defineLazyServiceGetter" in XPCOMUtils))
{
  XPCOMUtils.defineLazyServiceGetter = function XPCU_defineLazyServiceGetter(obj, prop, contract, iface)
  {
    obj.__defineGetter__(prop, function XPCU_serviceGetter()
    {
      delete obj[prop];
      return obj[prop] = Cc[contract].getService(Ci[iface]);
    });
  };
}

// Hack Utils.appID and Utils.platformVersion, K-Meleon doesn't have XULAppInfo
Cu.import("resource:///modules/adblockplus/Utils.jsm");
Utils.__defineGetter__("appID", function() "kmeleon@sf.net");
Utils.__defineGetter__("platformVersion", function() "1.9.1");

// Start up Bootstrap.jsm, it will initialize everything else
{
  Cu.import("resource:///modules/adblockplus/Bootstrap.jsm");
  Bootstrap.startup();
}

// Now we can load all the other modules we need
Cu.import("resource:///modules/adblockplus/AppIntegration.jsm");
Cu.import("resource:///modules/adblockplus/Prefs.jsm");

let windowWatcher = Cc["@mozilla.org/embedcomp/window-watcher;1"].getService(Ci.nsIWindowWatcher);

// Detect OEM locale to be used - yes, K-Meleon still doesn't support Unicode
let unicodeConverter = Cc["@mozilla.org/intl/scriptableunicodeconverter"].createInstance(Ci.nsIScriptableUnicodeConverter);
unicodeConverter.charset = "iso-8859-1";
try
{
  let xulRegistry = Cc["@mozilla.org/chrome/chrome-registry;1"].getService(Ci.nsIXULChromeRegistry);
  let locale = xulRegistry.getSelectedLocale("adblockplus");
  if (locale == "ru")
    unicodeConverter.charset = "windows-1251";
  else if (locale == "pl")
    unicodeConverter.charset = "windows-1250";
}
catch(e){}

function convertUIString(str)
{
  str = str.replace(/\u2026/g, '...');
  return unicodeConverter.ConvertFromUnicode(str);
}

// Register quit observer to shut down Bootstrap.jsm when necessary
{
  let observerService = Cc["@mozilla.org/observer-service;1"].getService(Ci.nsIObserverService);
  let observer = {
    observe: function(subject, topic, data)
    {
      if (topic == "quit-application")
      {
        observerService.removeObserver(this, "quit-application");
        Bootstrap.shutdown(false);
      }
    },

    QueryInterface: XPCOMUtils.generateQI([Ci.nsIObserver, Ci.nsISupportsWeakReference]),
  };
  observerService.addObserver(observer, "quit-application", true);
}

/**
 * Load overlay document with all elements AppIntegration expects.
 */
var overlay = null;
{
  let request = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance(Ci.nsIXMLHttpRequest);
  request.open("GET", "chrome://adblockplus/content/ui/overlayGeneral.xul", false);
  request.send(null);
  overlay = request.responseXML;

  let sidebarElement = overlay.querySelector('[id="abp-sidebar"]');
  if (sidebarElement)
    sidebarElement.parentNode.removeChild(sidebarElement);
}

/**
 * Object tracking windows and tabs.
 */
var windows =
{
  windows: {},

  init: function()
  {
    windowWatcher.registerNotification(this);
  },

  addWindow: function(hWnd)
  {
    if (hWnd in this.windows)
      return;

    let wnd = new FakeWindow(hWnd);
    AppIntegration.addWindow(wnd);
    wnd.wrapper = AppIntegration.getWrapperForWindow(wnd);
    this.windows[hWnd] = wnd;
  },

  removeWindow: function(hWnd)
  {
    if (!(hWnd in this.windows))
      return;

    this.windows[hWnd].triggerEvent("unload");
    delete this.windows[hWnd];
  },

  observe: function(subject, topic, data)
  {
    // Only look at content windows (tabs), not chrome windows
    if (!(subject instanceof Ci.nsIDOMWindow) || (subject instanceof Ci.nsIDOMChromeWindow))
      return;

    if (topic == "domwindowopened")
    {
      addRootListener(subject, "focus", true);
      addRootListener(subject, "contextmenu", true);
    }
  },

  getWindow: function(hWnd)
  {
    if (hWnd in this.windows)
      return this.windows[hWnd];
    else
      return null;
  },

  getWindowForTab: function(tab)
  {
    try
    {
      let hWnd = getHWND(windowWatcher.getChromeForWindow(tab).QueryInterface(Ci.nsIEmbeddingSiteWindow));
      return this.getWindow(hWnd);
    }
    catch (e)
    {
      return null;
    }
  },

  QueryInterface: XPCOMUtils.generateQI([Ci.nsIObserver, Ci.nsISupportsWeakReference])
}

/**
 * Fake abp-hooks element
 */
var hooks =
{
  getAttribute: function(attr)
  {
    if (attr == "currentVersion")
      return Prefs.currentVersion;
    else if (attr == "getBrowser")
      return "return this.window.getBrowser()";
    else if (attr == "addTab")
      return "return this.window.addTab(arguments[0])";
    else if (attr == "getContextMenu")
      return "return this.window.getContextMenu()";

    return null;
  }
};

// Fake window/document/browser to be given to the AppIntegration module
function FakeWindow(hWnd)
{
  this.hWnd = hWnd;
}
FakeWindow.prototype =
{
  QueryInterface: function() this,
  getInterface: function() this,

  wrapper: null,
  currentTab: null,

  allowSubframes: true,

  tooltipNode:
  {
    id: null,
    hasAttribute: function() true
  },
  popupNode: null,

  get document() this,

  getElementById: function(id)
  {
    if (id == "abp-hooks")
      return hooks;

    return overlay.querySelector('[id="' + id + '"]');
  },

  createElement: function(tagName)
  {
    return overlay.createElement(tagName);
  },

  listeners: {__proto__: null},
  addEventListener: function(eventType, handler)
  {
    if (!(eventType in this.listeners))
      this.listeners[eventType] = [];

    if (this.listeners[eventType].indexOf(handler) < 0)
      this.listeners[eventType].push(handler);
  },
  removeEventListener: function(eventType, handler)
  {
    if (!(eventType in this.listeners))
      return;

    let index = this.listeners[eventType].indexOf(handler);
    if (index >= 0)
      this.listeners[eventType].splice(index, 1);
  },
  triggerEvent: function(eventType)
  {
    if (!(eventType in this.listeners))
      return;

    let params = Array.prototype.slice.call(arguments, 1);
    for each (let listener in this.listeners[eventType])
      listener.apply(this, params);
  },

  triggerOverlayEvent: function(id, eventType)
  {
    let element = this.getElementById(id);
    if (!element)
      return;

    let event = overlay.createEvent("UIEvents");
    event.initUIEvent(eventType, false, true, null, 0);
    element.dispatchEvent(event);
  },

  addProgressListener: function(listener)
  {
    this.addEventListener("locationChange", listener.onLocationChange);
  },
  removeProgressListener: function(listener)
  {
    this.removeEventListener("locationChange", listener.onLocationChange);
  },

  get contentWindow() this.currentTab || {location: {href: "about:blank"}},
  get location() this.contentWindow.location,

  openDialog: function(url, windowName, features)
  {
    let params = null;
    if (arguments.length > 3)
    {
      params = Cc["@mozilla.org/array;1"].createInstance(Components.interfaces.nsIMutableArray);
      for (let i = 3; i < arguments.length; i++)
      {
        let variant = Cc["@mozilla.org/variant;1"].createInstance(Ci.nsIWritableVariant);
        variant.setAsInterface(Ci.nsIVariant, arguments[i]);
        params.appendElement(variant, false);
      }
    }

    return windowWatcher.openWindow(null, url, windowName, features, params);
  },

  setCurrentTab: function(tab)
  {
    if (tab == this.currentTab)
      return;

    this.currentTab = tab;
    this.triggerEvent("select");
    this.triggerEvent("locationChange");
  },

  addTab: function(url)
  {
    openTab(url, this.hWnd);
  },

  getBrowser: function()
  {
    return this;
  },

  getContextMenu: function()
  {
    return this.getElementById("abp-overlay-general");
  },
};

// Initialization
windows.init();

// Helper functions
function triggerEvent(element, eventType, eventObject)
{
}

let overlayContextMenuItems = {__proto__: null};
function triggerMenuItem(id)
{
  if (!(id in overlayContextMenuItems))
    return;

  let menuItem = overlayContextMenuItems[id];
  triggerEvent(menuItem.getAttribute("id"), "command");
}

// Entry points that the DLL will call
function onCommand(command, hWnd, id)
{
  let wnd = windows.getWindow(hWnd);
  if (!wnd)
    return;

  if (command == "blockable")
    wnd.wrapper.executeAction(1);
  else if (command == "settings")
    wnd.wrapper.executeAction(2);
  else if (command == "enable")
    wnd.wrapper.executeAction(3);
  else if (command == "removeWhitelist")
    wnd.triggerOverlayEvent("abp-removeWhitelist-menuitem", "command");
  else if (command == "frame")
    wnd.triggerOverlayEvent("abp-frame-menuitem", "command");
  else if (command == "object")
    wnd.triggerOverlayEvent("abp-object-menuitem", "command");
  else if (command == "media")
    wnd.triggerOverlayEvent("abp-media-menuitem", "command");
  else if (command == "image")
    wnd.triggerOverlayEvent("abp-image-menuitem", "command");
  else if (command == "toolbar")
    wnd.triggerOverlayEvent("abp-toolbarbutton", "command");
  else if (command == "statusbar")
    wnd.triggerOverlayEvent("abp-status", "click", {button: 0});
  else if (command == "menu")
    triggerMenuItem(id);
}

function onBrowserWindowOpened(hWnd)
{
  windows.addWindow(hWnd);
}

function onBrowserWindowClosed(hWnd)
{
  windows.removeWindow(hWnd);
}

function onDialogResize(hWnd)
{
}

function onDialogMove(hWnd)
{
}

let contextMenuItems = [
  "abp-removeWhitelist-menuitem",
  "abp-frame-menuitem",
  "abp-object-menuitem",
  "abp-media-menuitem",
  "abp-image-menuitem"
];

function onEvent(event)
{
  if (event.type == "contextmenu")
  {
    let tab = event.target.ownerDocument.defaultView.QueryInterface(Ci.nsIInterfaceRequestor)
                     .getInterface(Ci.nsIWebNavigation)
                     .QueryInterface(Ci.nsIDocShellTreeItem)
                     .rootTreeItem
                     .QueryInterface(Ci.nsIInterfaceRequestor)
                     .getInterface(Ci.nsIDOMWindow);
    let wnd = windows.getWindowForTab(tab);
    if (wnd)
    {
      resetContextMenu();

      wnd.popupNode = event.target;
      wnd.wrapper.updateContextMenu();
      wnd.popupNode = null;

      for (let i = 0; i < contextMenuItems.length; i++)
      {
        let element = wnd.getElementById(contextMenuItems[i]);
        if (!element.hidden)
          addContextMenuItem(i, convertUIString(element.getAttribute("label")));
      }
    }
  }
  else if (event.type == "focus" && event.target instanceof Components.interfaces.nsIDOMDocument)
  {
    let tab = event.target.defaultView;
    let wnd = windows.getWindowForTab(tab);
    if (wnd)
      wnd.setCurrentTab(tab);
  }
}

function getTooltipText(hWnd, status, unicode)
{
  let wnd = windows.getWindow(hWnd);
  if (!wnd)
    return null;

  wnd.tooltipNode.id = (status ? "abp-status" : "abp-toolbarbutton");

  tooltipValue = "";
  wnd.wrapper.fillTooltip({});

  var list = tooltipValue.replace(/[\r\n]+$/, '').split(/[\r\n]+/);
  if (list.length > 3)
    list.splice(3, 0, "", dtdReader.getEntity("filters.tooltip", unicode));
  if (list.length > 2)
    list.splice(2, 0, "", dtdReader.getEntity("blocked.tooltip", unicode));
  if (list.length > 1)
    list.splice(1, 0, "", dtdReader.getEntity("status.tooltip", unicode));

  return list.join("\n");
}

function buildContextMenu(hWnd, status)
{
  let wnd = windows.getWindow(hWnd);
  if (!wnd)
    return null;

  wnd.popupNode = {id: status ? "abp-status" : "abp-toolbarbutton"};
  wnd.wrapper.fillPopup({getAttribute: function() "abp-toolbar-popup"});
  wnd.popupNode = null;

  return addMenuItems(overlayContextMenu);
}
