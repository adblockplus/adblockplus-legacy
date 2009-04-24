var Node = Components.interfaces.nsIDOMNode;
var CSSPrimitiveValue = Components.interfaces.nsIDOMCSSPrimitiveValue;

var _currentWindow = null;
function onEvent(event) {
  if (event.type == "load")
    _windowMediator.processNewDialog(event.target.defaultView.top);
  else if (event.type == "contextmenu")
    gContextMenu.updateMenu(event.target);
  else if (event.type == "focus" && event.target instanceof Components.interfaces.nsIDOMDocument) {
    var wnd = event.target.defaultView;
    if (wnd != _currentWindow) {
      _currentWindow = wnd;
      if (!_initialized)
        _initOverlay();
      _browser.notifySelectListeners();
    }
  }
}

var _initialized = false;
function _initOverlay() {
  _initialized = true;
  Components.classes["@mozilla.org/moz/jssubscript-loader;1"]
            .getService(Components.interfaces.mozIJSSubScriptLoader)
            .loadSubScript("chrome://adblockplus/content/ui/overlay.js", this);
  _notifyLoadListeners();

  abp.__parent__.windowMediator = _windowMediator;
  abp.__parent__.windowWatcher = _windowMediator;
}

var _rdfService = Components.classes["@mozilla.org/rdf/rdf-service;1"]
                            .getService(Components.interfaces.nsIRDFService);
var _localStore = _rdfService.GetDataSourceBlocking("rdf:local-store");

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

function onDialogMove(hWnd) {
  var wnd = _windowMediator.toWindow(hWnd);
  if (!wnd)
    return;

  var resource = _getPersistResource(wnd);
  if (!resource)
    return;

  if (_windowMediator.shouldMove(hWnd)) {
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
  var wnd = _windowMediator.toWindow(hWnd);
  if (!wnd)
    return;

  var resource = _getPersistResource(wnd);
  if (!resource)
    return;

  if (_windowMediator.shouldResize(hWnd)) {
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

var tooltipValue = null;
function getTooltipText(status, unicode) {
  document.tooltipNode = {id: status ? "abp-status" : "abp-toolbarbutton", hasAttribute: function() {return true}};

  tooltipValue = "";
  abpFillTooltip({target: document.getElementById(null)});

  var list = tooltipValue.replace(/[\r\n]+$/, '').split(/[\r\n]+/);
  if (list.length > 3)
    list.splice(3, 0, "", _dtdReader.getEntity("filters.tooltip", unicode));
  if (list.length > 2)
    list.splice(2, 0, "", _dtdReader.getEntity("blocked.tooltip", unicode));
  if (list.length > 1)
    list.splice(1, 0, "", _dtdReader.getEntity("status.tooltip", unicode));

  return list.join("\n");
}

var _overlayContextMenu = function() {
  var request = Components.classes["@mozilla.org/xmlextras/xmlhttprequest;1"]
                          .createInstance(Components.interfaces.nsIXMLHttpRequest);
  request.open("GET", "chrome://adblockplus/content/ui/overlayGeneral.xul", false);
  request.send(null);

  var doc = request.responseXML;
  var ret = doc.getElementsByTagNameNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", "popup")
               .item(0).QueryInterface(Components.interfaces.nsIDOMXULElement);
  var menuitems = ret.getElementsByTagName("menuitem");
  for (var i = 0; i < menuitems.length; i++)
  {
    var menuitem = menuitems.item(i).QueryInterface(Components.interfaces.nsIDOMXULElement);
    if (menuitem.hasAttribute("command"))
    {
      var command = doc.getElementById(menuitem.getAttribute("command"));
      if (command && command.hasAttribute("oncommand"))
        menuitem.setAttribute("oncommand", command.getAttribute("oncommand"));
    }
  }
  return ret;
}();
var _overlayContextMenuItems = {};

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
                    _dtdReader.unicodeConverter.ConvertFromUnicode(child.getAttribute("label")),
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

function onCommand(command, hWnd, id) {
  if (command == "blockable")
    abpExecuteAction(1);
  else if (command == "settings")
    abpExecuteAction(2);
  else if (command == "enable")
    abpExecuteAction(3);
  else if (command == "image")
    abpNode(gContextMenu.abpBgData || gContextMenu.abpData);
  else if (command == "object")
    abpNode(gContextMenu.abpData);
  else if (command == "frame")
    abpNode(gContextMenu.abpFrameData);
  else if (command == "toolbar")
    abpCommandHandler({target: {set open() {showToolbarContext(hWnd)}}});
  else if (command == "statusbar")
    abpClickHandler({button: 0});
  else if (command == "menu")
    triggerMenuItem(id);
}

function openDialog(url, target, features) {
  var args = null;
  if (arguments.length > 3)
  {
    args = Components.classes["@mozilla.org/supports-array;1"]
                     .createInstance(Components.interfaces.nsISupportsArray);
    for (var i = 3; i < arguments.length; i++)
      args.AppendElement(arguments[i].wrappedJSObject = arguments[i]);
  }

  var watcher = Components.classes["@mozilla.org/embedcomp/window-watcher;1"]
                          .getService(Components.interfaces.nsIWindowWatcher);
  return watcher.openWindow(window, url, target, features, args);
}