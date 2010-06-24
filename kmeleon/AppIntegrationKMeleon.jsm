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

// Fake abphooks element
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

// Fake window/document/hooks element to be given to the AppIntegration module
var fakeWindow =
{
  QueryInterface: function() this,
  getInterface: function() this,

  allowSubframes: true,

  tooltipNode:
  {
    id: null,
    hasAttribute: function() true
  },
  popupNode:
  {
    id: null
  },

  get document() this,

  getElementById: function(id)
  {
    if (id == "abp-hooks")
      return hooks;

    return null;
  },

  addEventListener: function() {},
  removeEventListener: function() {},
  addProgressListener: function() {},
  removeProgressListener: function() {},

  contentWindow: {location: {href: "about:blank"}},
  get location() this.contentWindow.location,

  addTab: function(url)
  {
  },

  getBrowser: function()
  {
    return this;
  },

  getContextMenu: function()
  {
    return null;
  },
};

AppIntegration.addWindow(fakeWindow);
var wrapper = AppIntegration.getWrapperForWindow(fakeWindow);

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
  if (command == "blockable")
    wrapper.executeAction(1);
  else if (command == "settings")
    wrapper.executeAction(2);
  else if (command == "enable")
    wrapper.executeAction(3);
  else if (command == "image")
    triggerEvent("abp-image-menuitem", "command");
  else if (command == "object")
    triggerEvent("abp-object-menuitem", "command");
  else if (command == "frame")
    triggerEvent("abp-frame-menuitem", "command");
  else if (command == "toolbar")
    triggerEvent("abp-toolbarbutton", "command");
  else if (command == "statusbar")
    triggerEvent("abp-status", "click", {button: 0});
  else if (command == "menu")
    triggerMenuItem(id);
}

function getTooltipText(status, unicode)
{
  fakeWindow.tooltipNode.id = (status ? "abp-status" : "abp-toolbarbutton");

  tooltipValue = "";
  wrapper.fillTooltip({});

  var list = tooltipValue.replace(/[\r\n]+$/, '').split(/[\r\n]+/);
  if (list.length > 3)
    list.splice(3, 0, "", dtdReader.getEntity("filters.tooltip", unicode));
  if (list.length > 2)
    list.splice(2, 0, "", dtdReader.getEntity("blocked.tooltip", unicode));
  if (list.length > 1)
    list.splice(1, 0, "", dtdReader.getEntity("status.tooltip", unicode));

  return list.join("\n");
} 

function onDialogResize(hWnd)
{
}

function onDialogMove(hWnd)
{
}

function onEvent(event)
{
}

function buildContextMenu()
{
  document.popupNode.id = (status ? "abp-status" : "abp-toolbarbutton");
  abpFillPopup(overlayContextMenu);

  return addMenuItems(overlayContextMenu);
}
