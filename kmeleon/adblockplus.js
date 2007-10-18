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
var _overlayDTD = function() {
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

function _getOverlayEntity(name) {
  var ellipsis = false;
  if (/\.{3}$/.test(name)) {
    ellipsis = true;
    name = name.replace(/\.{3}$/, "");
  }
  var ret = (name in _overlayDTD ? _overlayDTD[name] : name) + (ellipsis ? "..." : "");
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

var _lastRequested = null;
function getElementById(id) {
  if (id == "abp-sidebar")
    return null;

  _lastRequested = id;
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
  if (_lastRequested == "abp-status")
    return "statusbarpanel";
  if (_lastRequested == "abp-toolbarbutton")
    return "toolbarbutton";

  return null;
});

this.__defineGetter__("hidden", function() {
  return false;
});
this.__defineSetter__("hidden", function(val) {
  if (_lastRequested == "abp-status")
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
  else if (attr == "value" && /^abp-tooltip-/.test(_lastRequested))
    tooltipValue += value + "\n";
}

function removeAttribute(attr) {
  if (attr == "deactivated" || attr == "whitelisted")
    setIconDelayed(0);
}

var _selectListeners = [];

function addEventListener(event, handler, capture) {
  if (event == "select")
    _selectListeners.push(handler);
}

function removeEventListener(event, handler, capture) {
  if (event == "select")
    _selectListeners = _selectListeners.filter(function(item) {return item != handler});
}

function _notifySelectListeners() {
  for (var i = 0; i < _selectListeners.length; i++)
    _selectListeners[i].call(this, null);
}

var _overlayContextMenu = function() {
  var request = Components.classes["@mozilla.org/xmlextras/xmlhttprequest;1"]
                          .createInstance(Components.interfaces.nsIXMLHttpRequest);
  request.open("GET", "chrome://adblockplus/content/overlayGeneral.xul", false);
  request.send(null);

  var ret = request.responseXML
                .getElementsByTagNameNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", "popup")
                .item(0).QueryInterface(Components.interfaces.nsIDOMXULElement);
  return ret;
}();
var _overlayContextMenuItems = {};

function getTooltipText(status) {
  document.tooltipNode = {id: status ? "abp-status" : "abp-toolbarbutton", hasAttribute: function() {return true}};

  tooltipValue = "";
  abpFillTooltip({target: this});

  var list = tooltipValue.replace(/[\r\n]+$/, '').split(/[\r\n]+/);
  if (list.length > 3)
    list.splice(3, 0, "", _getOverlayEntity("filters.tooltip"));
  if (list.length > 2)
    list.splice(2, 0, "", _getOverlayEntity("blocked.tooltip"));
  if (list.length > 1)
    list.splice(1, 0, "", _getOverlayEntity("status.tooltip"));

  return list.join("\n");
}

function buildContextMenu(status) {
  document.popupNode = {id: status ? "abp-status" : "abp-toolbarbutton"};
  abpFillPopup(_overlayContextMenu);

  return addMenuItems(_overlayContextMenu);
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
        _overlayContextMenuItems[child.menuID] = child;
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
  if (!(id in _overlayContextMenuItems))
    return;

  var menuItem = _overlayContextMenuItems[id];
  if (!menuItem.hasAttribute("oncommand"))
    return;

  var func = function() {eval(this.getAttribute("oncommand"))};
  func.apply(menuItem);
}

var _currentWindow = null;
var _hwndToWindow = {};
var _recentWindowTypes = {};

this.__defineGetter__("content", function() {
  return (_currentWindow && !_currentWindow.closed ? XPCNativeWrapper(_currentWindow) : null);
});
this.__defineGetter__("contentWindow", function() {
  return (_currentWindow && !_currentWindow.closed ? XPCNativeWrapper(_currentWindow) : null);
});

var _windowObserver = {
  observe: function(wnd, topic, data) {
    if (topic == "domwindowopened") {
      var wndType = wnd.QueryInterface(Components.interfaces.nsIInterfaceRequestor)
                       .getInterface(Components.interfaces.nsIWebNavigation)
                       .QueryInterface(Components.interfaces.nsIDocShellTreeItem)
                       .itemType;

      if (wndType == Components.interfaces.nsIDocShellTreeItem.typeContent)
        addRootListener(wnd, "focus", true);
      else
        wnd.addEventListener("load", _processNewDialog, true);
    }
    else if (topic == "domwindowclosed") {
      var hWnd = _getHWND(wnd);
      if (hWnd && hWnd in _hwndToWindow)
        delete _hwndToWindow[hWnd];
    }
  },
  QueryInterface: function(iid) {
    if (iid.equals(Components.interfaces.nsISupports) ||
        iid.equals(Components.interfaces.nsIObserver))
      return this;

    throw Components.results.NS_ERROR_NO_INTERFACE;
  }
};

var _windowWatcher = Components.classes["@mozilla.org/embedcomp/window-watcher;1"]
                               .getService(Components.interfaces.nsIWindowWatcher);
_windowWatcher.registerNotification(_windowObserver);

var _rdfService = Components.classes["@mozilla.org/rdf/rdf-service;1"]
                            .getService(Components.interfaces.nsIRDFService);
var _localStore = _rdfService.GetDataSourceBlocking("rdf:local-store");

function _getHWND(wnd) {
  try {
    return getHWND(_windowWatcher.getChromeForWindow(wnd)
                                 .QueryInterface(Components.interfaces.nsIEmbeddingSiteWindow));
  }
  catch (e) {
    return null;
  }
}

function _processNewDialog(event) {
  var wnd = event.target.defaultView;
  if (wnd.location.protocol != "chrome:" || wnd.location.host != "adblockplus")
    return;

  wnd.removeEventListener("load", _processNewDialog, true);

  var hWnd = _getHWND(wnd);
  if (!hWnd)
    return;

  subclassDialogWindow(hWnd);

  _hwndToWindow[hWnd] = wnd;
  _hwndToWindow["move" + hWnd] = true;
  _hwndToWindow["resize" + hWnd] = true;

  var oldFocus = wnd.focus;
  wnd.focus = function() {
    focusWindow(hWnd);
  };

  var root = wnd.document.documentElement;
  if (root.hasAttribute("windowtype"))
    _recentWindowTypes[root.getAttribute("windowtype")] = wnd;

  if (wnd.location.href.indexOf("settings.xul") >= 0) {
    try {
      wnd.document.getElementById("showintoolbar").hidden = true;
    }
    catch (e) {}
  }
}

var target;
function _handleEvent(event) {
  if (event.type == "contextmenu") {
    resetContextMenu();
    target = event.target;
    abpCheckContext();
  }
  else if (event.type == "focus") {
    var wnd = event.target.defaultView;
    if (wnd != _currentWindow) {
      _currentWindow = wnd;
      if (!_initialized)
        _initOverlay();
      _notifySelectListeners();
    }
  }
}

function _getPersistResource(wnd) {
  var root = wnd.document.documentElement;
  if (!root.hasAttribute("id") || !root.hasAttribute("persist"))
    return null;

  return _rdfService.GetResource(wnd.location.href + "#" + root.getAttribute("id"));
}

function _getLocalStoreInt(resource, property) {
  var link = _rdfService.GetResource(property);
  var target = _localStore.GetTarget(resource, link, true);
  try {
    return target.QueryInterface(Components.interfaces.nsIRDFInt).Value;
  }
  catch (e) {
    return 0;
  }
}

function _setLocalStoreInt(resource, property, value) {
  var link = _rdfService.GetResource(property);

  var oldTarget = _localStore.GetTarget(resource, link, true)
  if (oldTarget)
    _localStore.Unassert(resource, link, oldTarget);

  var target = _rdfService.GetIntLiteral(value);
  _localStore.Assert(resource, link, target, true);
}

function onWindowFocus(hWnd) {
  var wnd = _hwndToWindow[hWnd];
  if (!wnd)
    return;

  _currentWindow = wnd;
  _notifySelectListeners();
}

function onDialogMove(hWnd) {
  var wnd = _hwndToWindow[hWnd];
  if (!wnd)
    return;

  var resource = _getPersistResource(wnd);
  if (!resource)
    return;

  if ("move" + hWnd in _hwndToWindow) {
    delete _hwndToWindow["move" + hWnd];

    var left = _getLocalStoreInt(resource, "left");
    var top = _getLocalStoreInt(resource, "top");
    if (left && top)
      wnd.moveTo(left, top);
  }
  else
  {
    _setLocalStoreInt(resource, "left", wnd.screenX);
    _setLocalStoreInt(resource, "top", wnd.screenY);
  }
}

function onDialogResize(hWnd) {
  var wnd = _hwndToWindow[hWnd];
  if (!wnd)
    return;

  var resource = _getPersistResource(wnd);
  if (!resource)
    return;

  if ("resize" + hWnd in _hwndToWindow) {
    delete _hwndToWindow["resize" + hWnd];

    var width = _getLocalStoreInt(resource, "width");
    var height = _getLocalStoreInt(resource, "height");
    if (!width && !height && wnd.location.href.indexOf("sidebarDetached.xul") >= 0)
    {
      // Fix default size for detached sidebar
      width = 600;
      height = 400;
    }
    if (width && height)
      wnd.resizeTo(width, height);
  }
  else
  {
    _setLocalStoreInt(resource, "width", wnd.outerWidth);
    _setLocalStoreInt(resource, "height", wnd.outerHeight);
  }
}

var _initialized = false;
function _initOverlay() {
  _initialized = true;
  Components.classes["@mozilla.org/moz/jssubscript-loader;1"]
            .getService(Components.interfaces.mozIJSSubScriptLoader)
            .loadSubScript("chrome://adblockplus/content/overlay.js", this);
  abpInit();

  abp.getMostRecentWindow = function(type) {
    if (type == "navigator:browser")
      return this.__parent__;
    else if (type in _recentWindowTypes && !_recentWindowTypes[type].closed)
      return _recentWindowTypes[type];
    else
      return null;
  }
}