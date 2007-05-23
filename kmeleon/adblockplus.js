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

var Node = Components.interfaces.nsIDOMNode;
var CSSPrimitiveValue = Components.interfaces.nsIDOMCSSPrimitiveValue;
var window = this;
var document = this;
var location = this;
var documentElement = this;
var parentNode = this;
var style = this;
var gContextMenu = this;
var curState = null;
var tooltipValue = null;

var currentLocale = null;
if ("@mozilla.org/chrome/chrome-registry;1" in Components.classes) {
  try {
    var xulRegistry = Components.classes["@mozilla.org/chrome/chrome-registry;1"]
                                .getService(Components.interfaces.nsIXULChromeRegistry);
    currentLocale = xulRegistry.getSelectedLocale("adblockplus");
  } catch(e) {}
}

var unicodeConverter = Components.classes["@mozilla.org/intl/scriptableunicodeconverter"]
                                 .createInstance(Components.interfaces.nsIScriptableUnicodeConverter);
if (currentLocale)
  unicodeConverter.charset = (currentLocale == "ru-RU" ? "windows-1251" : "iso-8859-1");
else
  unicodeConverter.charset = "{{CHARSET}}";
var overlayDTD = function() {
  var request = Components.classes["@mozilla.org/xmlextras/xmlhttprequest;1"]
                          .createInstance(Components.interfaces.nsIXMLHttpRequest);
  request.open("GET", "chrome://adblockplus/locale/overlay.dtd", false);
  request.send(null);

  var ret = {};
  ret.__proto__ = null;
  request.responseText.replace(/<!ENTITY\s+([\w.]+)\s+"([^"]+?)">/ig, function(match, key, value) {ret[key] = value});

  for (var key in ret) {
    if (/(.*)\.label$/.test(key)) {
      var base = RegExp.$1;
      var value = ret[key];
      if (base + ".accesskey" in ret)
        value = value.replace(new RegExp(ret[base + ".accesskey"], "i"), "&$&");
      ret[base] = value;
    }
  }

  return ret;
}();

function getOverlayEntity(name) {
  var ellipsis = false;
  if (/\.{3}$/.test(name)) {
    ellipsis = true;
    name = name.replace(/\.{3}$/, "");
  }
  var ret = (name in overlayDTD ? overlayDTD[name] : name) + (ellipsis ? "..." : "");
  return unicodeConverter.ConvertFromUnicode(ret);
}

function QueryInterface(iid) {
  if (iid.equals(Components.interfaces.nsISupports) ||
      iid.equals(Components.interfaces.nsIDOMWindow) ||
      iid.equals(Components.interfaces.nsIDOMWindowInternal))
    return this;

  if (iid.equals(Components.interfaces.nsIClassInfo))
    return this.wrapper;

  throw Components.results.NS_ERROR_NO_INTERFACE;
}

this.getBrowser = this.appendChild = this.createElement = function() {return this};

function getElementsByTagName(name) {
  return [this];
}

var lastRequested = null;
function getElementById(id) {
  if (id == "abp-sidebar")
    return null;

  lastRequested = id;
  return this;
}

var timers = [];
function setInterval(callback, delay) {
  var timer = Components.classes["@mozilla.org/timer;1"]
                        .createInstance(Components.interfaces.nsITimer);
  timer.init({observe: callback}, delay, Components.interfaces.nsITimer.TYPE_REPEATING_SLACK);
  timers.push(timer);
}

function setTimeout(callback, delay) {
  var timer = Components.classes["@mozilla.org/timer;1"]
                        .createInstance(Components.interfaces.nsITimer);
  timer.init({observe: callback}, 0, Components.interfaces.nsITimer.TYPE_ONE_SHOT);
}

this.__defineGetter__("tagName", function() {
  if (lastRequested == "abp-status")
    return "statusbarpanel";
  if (lastRequested == "abp-toolbarbutton")
    return "toolbarbutton";

  return null;
});

this.__defineGetter__("hidden", function() {
  return false;
});
this.__defineSetter__("hidden", function(val) {
  if (lastRequested == "abp-status")
    hideStatusBar(val);
});

function hasAttribute(attr) {
  if (attr == "chromehidden")
    return true;

  return false;
}

function getAttribute(attr) {
  if (attr == "chromehidden")
    return "extrachrome";
  else if (attr == "curstate")
    return curState;

  return null;
}

var iconDelayed;
function setIconDelayed(icon) {
  iconDelayed = icon;

  var timer = Components.classes["@mozilla.org/timer;1"]
                        .createInstance(Components.interfaces.nsITimer);
  timer.init({observe: function() {setIcon(iconDelayed)}}, 0, Components.interfaces.nsITimer.TYPE_ONE_SHOT);
}

function setAttribute(attr, value) {
  if (attr == "deactivated")
    setIconDelayed(1);
  else if (attr == "whitelisted")
    setIconDelayed(2);
  else if (attr == "curstate")
    curState = value;
  else if (attr == "value" && /^abp-tooltip-/.test(lastRequested))
    tooltipValue += value + "\n";
}

function removeAttribute(attr) {
  if (attr == "deactivated" || attr == "whitelisted")
    setIconDelayed(0);
}

var overlayContextMenu = function() {
  var request = Components.classes["@mozilla.org/xmlextras/xmlhttprequest;1"]
                          .createInstance(Components.interfaces.nsIXMLHttpRequest);
  request.open("GET", "chrome://adblockplus/content/overlayGeneral.xul", false);
  request.send(null);

  var ret = request.responseXML
                .getElementsByTagNameNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", "popup")
                .item(0).QueryInterface(Components.interfaces.nsIDOMXULElement);
  return ret;
}();
var overlayContextMenuItems = {};

function getTooltipText(status) {
  document.tooltipNode = {id: status ? "abp-status" : "abp-toolbarbutton", hasAttribute: function() {return true}};

  tooltipValue = "";
  abpFillTooltip({target: this});

  var list = tooltipValue.replace(/[\r\n]+$/, '').split(/[\r\n]+/);
  if (list.length > 3)
    list.splice(3, 0, "", getOverlayEntity("filters.tooltip"));
  if (list.length > 2)
    list.splice(2, 0, "", getOverlayEntity("blocked.tooltip"));
  if (list.length > 1)
    list.splice(1, 0, "", getOverlayEntity("status.tooltip"));

  return list.join("\n");
}

function buildContextMenu(status) {
  document.popupNode = {id: status ? "abp-status" : "abp-toolbarbutton"};
  abpFillPopup(overlayContextMenu);

  return addMenuItems(overlayContextMenu);
}

function addMenuItems(popup) {
  var menu = createPopupMenu();

  for (var child = popup.firstChild; child; child = child.nextSibling) {
    if (child.nodeType != Node.ELEMENT_NODE || child.hidden)
      continue;

    // We should not show "show in toolbar" option
    if (child.tagName == "menuitem" && child.getAttribute("id") == "abp-status-showintoolbar")
      continue;

    var type = 0;
    if (child.tagName == "menuseparator")
      type = -1;
    else if (child.tagName == "menu")
      type = addMenuItems(child.getElementsByTagName("menupopup")[0]);

    if (!("menuID" in child)) {
      if (child.tagName == "menuitem") {
        child.menuID = createCommandID();
        overlayContextMenuItems[child.menuID] = child;
      }
      else
        child.menuID = -1;
    }

    addMenuItem(menu, type, child.menuID,
                    unicodeConverter.ConvertFromUnicode(child.getAttribute("label")),
                    child.getAttribute("default") == "true",
                    child.getAttribute("disabled") == "true",
                    child.getAttribute("checked") == "true");

    // Toggle checkbox selection so if it is clicked we get the right value
    if (child.getAttribute("type") == "checkbox") {
      if (child.getAttribute("checked") == "true")
        child.removeAttribute("checked");
      else
        child.setAttribute("checked", "true");
    }
  }

  return menu;
}

function triggerMenuItem(id) {
  if (!(id in overlayContextMenuItems))
    return;

  var menuItem = overlayContextMenuItems[id];
  if (!menuItem.hasAttribute("oncommand"))
    return;

  var func = function() {eval(this.getAttribute("oncommand"))};
  func.apply(menuItem);
}

function wrapNode(node) {
  return abp.__parent__.wrapNode(node);
}

Components.classes["@mozilla.org/moz/jssubscript-loader;1"]
          .getService(Components.interfaces.mozIJSSubScriptLoader)
          .loadSubScript("chrome://adblockplus/content/overlay.js", this);
