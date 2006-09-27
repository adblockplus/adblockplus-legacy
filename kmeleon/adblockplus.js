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
  callback();
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

Components.classes["@mozilla.org/moz/jssubscript-loader;1"]
          .getService(Components.interfaces.mozIJSSubScriptLoader)
          .loadSubScript("chrome://adblockplus/content/overlay.js", this);
