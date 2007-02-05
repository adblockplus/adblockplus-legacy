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

var Node = Components.interfaces.nsIDOMNode;
var CSSPrimitiveValue = Components.interfaces.nsIDOMCSSPrimitiveValue;
var window = this;
var document = this;
var location = this;
var documentElement = this;
var parentNode = this;
var style = this;
var gContextMenu = this;

var unicodeConverter = Components.classes["@mozilla.org/intl/scriptableunicodeconverter"]
                                 .createInstance(Components.interfaces.nsIScriptableUnicodeConverter);
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

this.getBrowser = this.appendChild = function() {return this};

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
}

function removeAttribute(attr) {
  if (attr == "deactivated" || attr == "whitelisted")
    setIconDelayed(0);
}

/*function removeWhitespace(element) {
  element.QueryInterface(Components.interfaces.nsIDOMXULElement);
  for (var child = element.firstChild; child; child = child.nextSibling) {
    if (child.nodeType != Node.ELEMENT_NODE) {
      var newChild = child.nextSibling;
      child.parentNode.removeChild(child);
      child = {nextSibling: newChild};
    }
    else
      removeWhitespace(child);
  }
}*/

var overlayContextMenu = function() {
  var request = Components.classes["@mozilla.org/xmlextras/xmlhttprequest;1"]
                          .createInstance(Components.interfaces.nsIXMLHttpRequest);
  request.open("GET", "chrome://adblockplus/content/overlay.xul", false);
  request.send(null);

  var ret = request.responseXML
                .getElementsByTagNameNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", "popup")
                .item(0).QueryInterface(Components.interfaces.nsIDOMXULElement);
//  removeWhitespace(ret);
  return ret;
}();
var overlayContextMenuItems = {};

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
