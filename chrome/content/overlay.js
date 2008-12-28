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
 * Portions created by the Initial Developer are Copyright (C) 2006-2008
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * ***** END LICENSE BLOCK ***** */

var abp = null;
try {
  abp = Components.classes["@mozilla.org/adblockplus;1"].createInstance().wrappedJSObject;

  if (!abp.prefs.initialized)
    abp = null;
} catch (e) {}

var abpPrefs = abp ? abp.prefs : {enabled: false};
var abpDetachedSidebar = null;
var abpOldShowInToolbar = abpPrefs.showintoolbar;
var abpHideImageManager;

window.addEventListener("load", abpInit, false);

function abpInit() {
  window.addEventListener("unload", abpUnload, false);

  // Process preferences
  abpReloadPrefs();
  if (abp) {
    abpPrefs.addListener(abpReloadPrefs);

    // Make sure whitelisting gets displayed after at most 2 seconds
    setInterval(abpReloadPrefs, 2000);
    abpGetBrowser().addEventListener("select", abpReloadPrefs, false); 

    // Make sure we always configure keys but don't let them break anything
    try {
      // Configure keys
      for (var key in abpPrefs)
        if (key.match(/(.*)_key$/))
          abpConfigureKey(RegExp.$1, abpPrefs[key]);
    } catch(e) {}
  }

  // Install context menu handler
  var contextMenu = document.getElementById("contentAreaContextMenu") || document.getElementById("messagePaneContext") || document.getElementById("popup_content");
  if (contextMenu) {
    contextMenu.addEventListener("popupshowing", abpCheckContext, false);
  
    // Make sure our context menu items are at the bottom
    contextMenu.appendChild(document.getElementById("abp-frame-menuitem"));
    contextMenu.appendChild(document.getElementById("abp-object-menuitem"));
    contextMenu.appendChild(document.getElementById("abp-image-menuitem"));
  }

  // First run actions
  if (abp && !("doneFirstRunActions" in abpPrefs) && abp.versionComparator.compare(abpPrefs.lastVersion, "0.0") <= 0)
  {
    // Don't repeat first run actions if new window is opened
    abpPrefs.doneFirstRunActions = true;

    // Add ABP icon to toolbar if necessary
    setTimeout(abpInstallInToolbar, 0);

    // Show subscriptions dialog if the user doesn't have any subscriptions yet
    setTimeout(abpShowSubscriptions, 0);
  }

  // Move toolbar button to a correct location in Mozilla/SeaMonkey
  var button = document.getElementById("abp-toolbarbutton");
  if (button && button.parentNode.id == "nav-bar-buttons") {
    var ptf = document.getElementById("bookmarks-ptf");
    ptf.parentNode.insertBefore(button, ptf);
  }

  // Copy the menu from status bar icon to the toolbar
  var fixId = function(node) {
    if (node.nodeType != Node.ELEMENT_NODE)
      return node;

    if ("id" in node && node.id)
      node.id = node.id.replace(/abp-status/, "abp-toolbar");

    for (var child = node.firstChild; child; child = child.nextSibling)
      fixId(child);

    return node;
  };
  var copyMenu = function(to) {
    if (!to || !to.firstChild)
      return;

    to = to.firstChild;
    var from = document.getElementById("abp-status-popup");
    for (var node = from.firstChild; node; node = node.nextSibling)
      to.appendChild(fixId(node.cloneNode(true)));
  };
  copyMenu(document.getElementById("abp-toolbarbutton"));
  copyMenu(abpGetPaletteButton());

  setTimeout(abpInitImageManagerHiding, 0);
}

function abpUnload() {
  abpPrefs.removeListener(abpReloadPrefs);
  abpGetBrowser().removeEventListener("select", abpReloadPrefs, false); 
}

function abpGetBrowser() {
  if ("getBrowser" in window)
    return getBrowser();
  else if ("messageContent" in window)
    return window.messageContent;
  else
    return document.getElementById("frame_main_pane") || document.getElementById("browser_content");
}

function abpReloadPrefs() {
  var label;
  var state = null;
  if (abp) {
    if (abpPrefs.enabled)
      state = "active";
    else
      state = "disabled";

    label = abp.getString("status_" + state + "_label");

    if (state == "active")
    {
      let location = null;
      if ("currentHeaderData" in window && "content-base" in currentHeaderData)
      {
        // Thunderbird blog entry
        location = currentHeaderData["content-base"].headerValue;
      }
      else if ("gDBView" in window)
      {
        // Thunderbird mail/newsgroup entry
        try
        {
          var msgHdr = gDBView.hdrForFirstSelectedMessage;
          var headerParser = Components.classes["@mozilla.org/messenger/headerparser;1"]
                                      .getService(Components.interfaces.nsIMsgHeaderParser);
          var emailAddress = headerParser.extractHeaderAddressMailboxes(null, msgHdr.author);
          if (emailAddress)
            location = 'mailto:' + emailAddress.replace(/^[\s"]+/, "").replace(/[\s"]+$/, "").replace(' ', '%20');
        }
        catch(e) {}
      }
      else
      {
        // Firefox web page
        location = abpGetBrowser().contentWindow.location.href;
      }

      if (location && abp.policy.isWhitelisted(location))
        state = "whitelisted";
    }
  }

  var tooltip = document.getElementById("abp-tooltip");
  if (state && tooltip)
    tooltip.setAttribute("curstate", state);

  var updateElement = function(element) {
    if (!element)
      return;

    if (abp) {
      element.removeAttribute("disabled");

      if (element.tagName == "statusbarpanel" || element.tagName == "vbox") {
        element.hidden = !abpPrefs.showinstatusbar;

        var labelElement = element.getElementsByTagName("label")[0];
        labelElement.setAttribute("value", label);
      }
      else
        element.hidden = !abpPrefs.showintoolbar;

      // HACKHACK: Show status bar icon in SeaMonkey Mail and Prism instead of toolbar icon
      if (element.hidden && (element.tagName == "statusbarpanel" || element.tagName == "vbox") && (document.getElementById("msgToolbar") || location.host == "webrunner"))
        element.hidden = !abpPrefs.showintoolbar;

      if (abpOldShowInToolbar != abpPrefs.showintoolbar)
        abpInstallInToolbar();

      abpOldShowInToolbar = abpPrefs.showintoolbar;
    }

    element.removeAttribute("deactivated");
    element.removeAttribute("whitelisted");
    if (state == "whitelisted")
      element.setAttribute("whitelisted", "true");
    else if (state == "disabled")
      element.setAttribute("deactivated", "true");
  };

  var status = document.getElementById("abp-status");
  updateElement(status);
  if (abpPrefs.defaultstatusbaraction == 0)
    status.setAttribute("popup", status.getAttribute("context"));
  else
    status.removeAttribute("popup");

  var button = document.getElementById("abp-toolbarbutton");
  updateElement(button);
  if (button) {
    if (button.hasAttribute("context") && abpPrefs.defaulttoolbaraction == 0)
    {
      button.setAttribute("popup", button.getAttribute("context"));
      button.removeAttribute("type");
    }
    else
      button.removeAttribute("popup");
  }

  updateElement(abpGetPaletteButton());
}

function abpInitImageManagerHiding() {
  if (!abp || typeof abpHideImageManager != "undefined")
    return;

  abpHideImageManager = false;
  if (abpPrefs.hideimagemanager && "@mozilla.org/permissionmanager;1" in Components.classes) {
    try {
      abpHideImageManager = true;
      var permissionManager = Components.classes["@mozilla.org/permissionmanager;1"]
                                        .getService(Components.interfaces.nsIPermissionManager);
      var enumerator = permissionManager.enumerator;
      while (abpHideImageManager && enumerator.hasMoreElements()) {
        var item = enumerator.getNext().QueryInterface(Components.interfaces.nsIPermission);
        if (item.type == "image" && item.capability == Components.interfaces.nsIPermissionManager.DENY_ACTION)
          abpHideImageManager = false;
      }
    } catch(e) {}
  }
}

function abpConfigureKey(key, value) {
  var valid = {
    accel: "accel",
    ctrl: "control",
    control: "control",
    shift: "shift",
    alt: "alt",
    meta: "meta"
  };

  var command = document.getElementById("abp-command-" + key);
  if (!command)
    return;

  var parts = value.split(/\s+/);
  var modifiers = [];
  var keychar = null;
  var keycode = null;
  for (var i = 0; i < parts.length; i++) {
    if (parts[i].toLowerCase() in valid)
      modifiers.push(parts[i].toLowerCase());
    else if (parts[i].length == 1)
      keychar = parts[i];
    else if ("DOM_VK_" + parts[i].toUpperCase() in Components.interfaces.nsIDOMKeyEvent)
      keycode = "VK_" + parts[i].toUpperCase();
  }

  if (keychar || keycode) {
    var element = document.createElement("key");
    element.setAttribute("id", "abp-key-" + key);
    element.setAttribute("command", "abp-command-" + key);
    if (keychar)
      element.setAttribute("key", keychar);
    else
      element.setAttribute("keycode", keycode);
    element.setAttribute("modifiers", modifiers.join(","));

    document.getElementById("abp-keyset").appendChild(element);
  }
}

// Finds the toolbar button in the toolbar palette
function abpGetPaletteButton() {
  var toolbox = document.getElementById("navigator-toolbox") || document.getElementById("mail-toolbox");
  if (!toolbox || !("palette" in toolbox) || !toolbox.palette)
    return null;

  for (var child = toolbox.palette.firstChild; child; child = child.nextSibling)
    if (child.id == "abp-toolbarbutton")
      return child;

  return null;
}

// Check whether we installed the toolbar button already
function abpInstallInToolbar() {
  if (!document.getElementById("abp-toolbarbutton")) {
    var insertBeforeBtn = null;
    var toolbar = document.getElementById("nav-bar");
    if (!toolbar) {
      insertBeforeBtn = "button-junk";
      toolbar = document.getElementById("mail-bar");
    }

    if (toolbar && "insertItem" in toolbar) {
      var insertBefore = (insertBeforeBtn ? document.getElementById(insertBeforeBtn) : null);
      if (insertBefore && insertBefore.parentNode != toolbar)
        insertBefore = null;

      toolbar.insertItem("abp-toolbarbutton", insertBefore, null, false);

      toolbar.setAttribute("currentset", toolbar.currentSet);
      document.persist(toolbar.id, "currentset");

      // HACKHACK: Make sure icon is added to both main window and message window in Thunderbird
      var override = null;
      if (window.location.href == "chrome://messenger/content/messenger.xul")
        override = "chrome://messenger/content/messageWindow.xul#mail-bar";
      else if (window.location.href == "chrome://messenger/content/messageWindow.xul")
        override = "chrome://messenger/content/messenger.xul#mail-bar";

      if (override) {
        try {
          var rdf = Components.classes["@mozilla.org/rdf/rdf-service;1"]
                              .getService(Components.interfaces.nsIRDFService);
          var localstore = rdf.GetDataSource("rdf:local-store");
          var resource = rdf.GetResource(override);
          var arc = rdf.GetResource("currentset");
          var target = localstore.GetTarget(resource, arc, true);
          var currentSet = (target ? target.QueryInterface(Components.interfaces.nsIRDFLiteral).Value : document.getElementById('mail-bar').getAttribute("defaultset"));

          if (/\bbutton-junk\b/.test(currentSet))
            currentSet = currentSet.replace(/\bbutton-junk\b/, "abp-toolbarbutton,button-junk");
          else
            currentSet = currentSet + ",abp-toolbarbutton";

          if (target)
            localstore.Unassert(resource, arc, target, true);
          localstore.Assert(resource, arc, rdf.GetLiteral(currentSet), true);
        } catch (e) {}
      }
    }
  }
}

// Let user choose subscriptions on first start unless he has some already
function abpShowSubscriptions()
{
  // Look for existing subscriptions
  for each (let subscription in abp.filterStorage.subscriptions)
    if (subscription instanceof abp.DownloadableSubscription)
      return;

  let browser = abpGetBrowser();
  if ("addTab" in browser)
  {
    // We have a tabbrowser
    browser.selectedTab = browser.addTab("chrome://adblockplus/content/tip_subscriptions.xul");
  }
  else
  {
	window.openDialog("chrome://adblockplus/content/tip_subscriptions.xul", "_blank", "chrome,centerscreen,resizable=no,dialog=no");
  }
}

function abpFillTooltip(ev) {
  if (!document.tooltipNode || !document.tooltipNode.hasAttribute("tooltip"))
    return false;

  if (abp) {
    abpReloadPrefs();

    var type = (document.tooltipNode && document.tooltipNode.id == "abp-toolbarbutton" ? "toolbar" : "statusbar");
    var action = parseInt(abpPrefs["default" + type + "action"]);
    if (isNaN(action))
      action = -1;

    var actionDescr = document.getElementById("abp-tooltip-action");
    actionDescr.hidden = (action < 0 || action > 3);
    if (!actionDescr.hidden)
      actionDescr.setAttribute("value", abp.getString("action" + action + "_tooltip"));

    var state = ev.target.getAttribute("curstate");
    var statusDescr = document.getElementById("abp-tooltip-status");
    statusDescr.setAttribute("value", abp.getString(state + "_tooltip"));

    var activeFilters = [];
    document.getElementById("abp-tooltip-blocked-label").hidden = (state != "active");
    document.getElementById("abp-tooltip-blocked").hidden = (state != "active");
    if (state == "active") {
      var data = abp.getDataForWindow(abpGetBrowser().contentWindow);
      var locations = data.getAllLocations();

      var blocked = 0;
      var filterCount = {__proto__: null};
      for (i = 0; i < locations.length; i++) {
        if (locations[i].filter && !(locations[i].filter instanceof abp.WhitelistFilter))
          blocked++;
        if (locations[i].filter) {
          if (locations[i].filter.text in filterCount)
            filterCount[locations[i].filter.text]++;
          else
            filterCount[locations[i].filter.text] = 1;
        }
      }

      var blockedStr = abp.getString("blocked_count_tooltip");
      blockedStr = blockedStr.replace(/--/, blocked).replace(/--/, locations.length);
      document.getElementById("abp-tooltip-blocked").setAttribute("value", blockedStr);

      var filterSort = function(a, b) {
        return filterCount[b] - filterCount[a];
      };
      for (var filter in filterCount)
        activeFilters.push(filter);
      activeFilters = activeFilters.sort(filterSort);
    }

    document.getElementById("abp-tooltip-filters-label").hidden = (activeFilters.length == 0);
    document.getElementById("abp-tooltip-filters").hidden = (activeFilters.length == 0);
    if (activeFilters.length > 0) {
      var filtersContainer = document.getElementById("abp-tooltip-filters");
      while (filtersContainer.firstChild)
        filtersContainer.removeChild(filtersContainer.firstChild);

      for (var i = 0; i < activeFilters.length && i < 3; i++) {
        var descr = document.createElement("description");
        descr.setAttribute("value", activeFilters[i] + " (" + filterCount[activeFilters[i]] + ")");
        filtersContainer.appendChild(descr);
      }
      if (activeFilters.length > 3) {
        var descr = document.createElement("description");
        descr.setAttribute("value", "...");
        filtersContainer.appendChild(descr);
      }
    }
  }
  return true;
}

// Fills the context menu on the status bar
function abpFillPopup(popup) {
  if (!abp)
    return false;

  // Not at-target call, ignore
  if (popup.getAttribute("id").indexOf("options") >= 0)
    return true;

  // Need to do it this way to prevent a Gecko bug from striking
  var elements = {};
  var list = popup.getElementsByTagName("menuitem");
  for (var i = 0; i < list.length; i++)
    if (list[i].id && /\-(\w+)$/.test(list[i].id))
      elements[RegExp.$1] = list[i];

  var sidebarOpen = abpIsSidebarOpen();
  elements.opensidebar.hidden = sidebarOpen;
  elements.closesidebar.hidden = !sidebarOpen;

  var whitelistItemSite = elements.whitelistsite;
  var whitelistItemPage = elements.whitelistpage;
  var whitelistSeparator = whitelistItemPage.nextSibling;
  while (whitelistSeparator.nodeType != Node.ELEMENT_NODE)
    whitelistSeparator = whitelistSeparator.nextSibling;

  var location = null;
  var site = null;
  if ("currentHeaderData" in window && "content-base" in currentHeaderData) {
    // Thunderbird blog entry
    location = abp.unwrapURL(currentHeaderData["content-base"].headerValue);
  }
  else if ("gDBView" in window) {
    // Thunderbird mail/newsgroup entry
    try {
      var msgHdr = gDBView.hdrForFirstSelectedMessage;
      var headerParser = Components.classes["@mozilla.org/messenger/headerparser;1"]
                                  .getService(Components.interfaces.nsIMsgHeaderParser);
      site = headerParser.extractHeaderAddressMailboxes(null, msgHdr.author);
      if (site)
        site = site.replace(/^[\s"]+/, "").replace(/[\s"]+$/, "");
    }
    catch(e) {
      site = null;
    }

    if (site) {
      whitelistItemSite.pattern = "@@|mailto:" + site.replace(' ', '%20') + "|";
      whitelistItemSite.setAttribute("checked", abpHasFilter(whitelistItemSite.pattern));
      whitelistItemSite.setAttribute("label", whitelistItemSite.getAttribute("labeltempl").replace(/--/, site));
    }
  }
  else {
    // Firefox web page
    location = abp.unwrapURL(abpGetBrowser().contentWindow.location.href);
  }

  if (!site && location) {
    if (abp.policy.isBlockableScheme(location)) {
      let ending = "|";
      if (location instanceof Components.interfaces.nsIURL && location.query)
      {
        location.query = "";
        ending = "?";
      }

      let url = location.spec;
      let host = location.host;
      site = url.replace(/^([^\/]+\/\/[^\/]+\/).*/, "$1");

      whitelistItemSite.pattern = "@@|" + site;
      whitelistItemSite.setAttribute("checked", abpHasFilter(whitelistItemSite.pattern));
      whitelistItemSite.setAttribute("label", whitelistItemSite.getAttribute("labeltempl").replace(/--/, host));

      whitelistItemPage.pattern = "@@|" + url + ending;
      whitelistItemPage.setAttribute("checked", abpHasFilter(whitelistItemPage.pattern));
    }
    else
      location = null;
  }

  whitelistItemSite.hidden = !site;
  whitelistItemPage.hidden = !location;
  whitelistSeparator.hidden = !site && !location;

  elements.enabled.setAttribute("checked", abpPrefs.enabled);
  elements.frameobjects.setAttribute("checked", abpPrefs.frameobjects);
  elements.slowcollapse.setAttribute("checked", !abpPrefs.fastcollapse);
  elements.showintoolbar.setAttribute("checked", abpPrefs.showintoolbar);
  elements.showinstatusbar.setAttribute("checked", abpPrefs.showinstatusbar);

  var defAction = (popup.tagName == "menupopup" || document.popupNode.id == "abp-toolbarbutton" ? abpPrefs.defaulttoolbaraction : abpPrefs.defaultstatusbaraction);
  elements.opensidebar.setAttribute("default", defAction == 1);
  elements.closesidebar.setAttribute("default", defAction == 1);
  elements.settings.setAttribute("default", defAction == 2);
  elements.enabled.setAttribute("default", defAction == 3);

  return true;
}

// Only show context menu on toolbar button in vertical toolbars
function abpCheckToolbarContext(event) {
  var toolbox = event.target;
  while (toolbox && toolbox.tagName != "toolbox")
    toolbox = toolbox.parentNode;

  if (!toolbox || toolbox.getAttribute("vertical") != "true")
    return;

  event.target.open = true;
  event.preventDefault();
}

function abpIsSidebarOpen() {
  // Test whether detached sidebar window is open
  if (abpDetachedSidebar && !abpDetachedSidebar.closed)
    return true;

  var sidebar = document.getElementById("abp-sidebar");
  return (sidebar ? !sidebar.hidden : false);
}

function abpToggleSidebar() {
  if (!abp)
    return;

  if (abpDetachedSidebar && !abpDetachedSidebar.closed)
    abpDetachedSidebar.close();
  else {
    var sidebar = document.getElementById("abp-sidebar");
    if (sidebar && (!abpPrefs.detachsidebar || !sidebar.hidden)) {
      document.getElementById("abp-sidebar-splitter").hidden = !sidebar.hidden;
      document.getElementById("abp-sidebar-browser").setAttribute("src", sidebar.hidden ? "chrome://adblockplus/content/sidebar.xul" : "about:blank");
      sidebar.hidden = !sidebar.hidden;
    }
    else
      abpDetachedSidebar = window.openDialog("chrome://adblockplus/content/sidebarDetached.xul", "_blank", "chrome,resizable,dependent,dialog=no,width=600,height=300");
  }

  let menuItem = document.getElementById("abp-blockableitems");
  if (menuItem)
    menuItem.setAttribute("checked", abpIsSidebarOpen());
}

/**
 * Checks whether the specified user-defined filter exists
 *
 * @param {String} filter   text representation of the filter
 */
function abpHasFilter(filter)
{
  filter = abp.Filter.fromText(filter);
  for each (let subscription in abp.filterStorage.subscriptions)
    if (subscription instanceof abp.SpecialSubscription && subscription.filters.indexOf(filter) >= 0)
      return true;

  return false;
}

// Toggles the value of a boolean pref
function abpTogglePref(pref) {
  if (!abp)
    return;

  abpPrefs[pref] = !abpPrefs[pref];
  abpPrefs.save();
}

// Inserts or removes the specified pattern into/from the list
function abpTogglePattern(text, insert) {
  if (!abp)
    return;

  if (insert)
    abp.addPatterns([text], 1);
  else
    abp.removePatterns([text], 1);

  // Make sure to display whitelisting immediately
  abpReloadPrefs();
}

// Handle clicks on the Adblock statusbar panel
function abpClickHandler(e) {
  if (e.button == 0)
    abpExecuteAction(abpPrefs.defaultstatusbaraction);
  else if (e.button == 1)
    abpTogglePref("enabled");
}

function abpCommandHandler(e) {
  if (abpPrefs.defaulttoolbaraction == 0)
    e.target.open = true;
  else
    abpExecuteAction(abpPrefs.defaulttoolbaraction);
}

// Executes default action for statusbar/toolbar by its number
function abpExecuteAction(action) {
  if (action == 1)
    abpToggleSidebar();
  else if (action == 2)
    abp.openSettingsDialog();
  else if (action == 3)
    abpTogglePref("enabled");
}

// Retrieves the image URL for the specified style property
function abpImageStyle(computedStyle, property) {
  var value = computedStyle.getPropertyCSSValue(property);
  if (value.primitiveType == CSSPrimitiveValue.CSS_URI)
    return abp.unwrapURL(value.getStringValue()).spec;

  return null;
}

// Hides the unnecessary context menu items on display
function abpCheckContext() {
  var contextMenu = document.getElementById("contentAreaContextMenu") || document.getElementById("messagePaneContext") || document.getElementById("popup_content");
  var target = document.popupNode;

  var nodeType = null;
  contextMenu.abpBgData = null;
  contextMenu.abpFrameData = null;
  if (abp && target) {
    // Lookup the node in our stored data
    var data = abp.getDataForNode(target);
    var targetNode = null;
    if (data) {
      targetNode = data[0];
      data = data[1];
    }
    contextMenu.abpData = data;
    if (data && !data.filter)
      nodeType = data.typeDescr;

    var wnd = (target ? target.ownerDocument.defaultView : null);
    var wndData = (wnd ? abp.getDataForWindow(wnd) : null);

    if (wnd.frameElement)
      contextMenu.abpFrameData = abp.getDataForNode(wnd.frameElement, true);
    if (contextMenu.abpFrameData)
      contextMenu.abpFrameData = contextMenu.abpFrameData[1];
    if (contextMenu.abpFrameData && contextMenu.abpFrameData.filter)
      contextMenu.abpFrameData = null;

    if (nodeType != "IMAGE") {
      // Look for a background image
      var imageNode = target;
      while (imageNode && !contextMenu.abpBgData) {
        if (imageNode.nodeType == Node.ELEMENT_NODE) {
          var bgImage = null;
          var style = wnd.getComputedStyle(imageNode, "");
          bgImage = abpImageStyle(style, "background-image") || abpImageStyle(style, "list-style-image");
          if (bgImage) {
            contextMenu.abpBgData = wndData.getLocation(abp.policy.type.BACKGROUND, bgImage);
            if (contextMenu.abpBgData && contextMenu.abpBgData.filter)
              contextMenu.abpBgData = null;
          }
        }

        imageNode = imageNode.parentNode;
      }
    }

    // Hide "Block Images from ..." if hideimagemanager pref is true and the image manager isn't already blocking something
    var imgManagerContext = document.getElementById("context-blockimage");
    if (imgManagerContext) {
      if (typeof abpHideImageManager == "undefined")
        abpInitImageManagerHiding();

      // Don't use "hidden" attribute - it might be overridden by the default popupshowing handler
      imgManagerContext.style.display = (abpHideImageManager ? "none" : "");
    }
  }

  document.getElementById("abp-image-menuitem").hidden = (nodeType != "IMAGE" && contextMenu.abpBgData == null);
  document.getElementById("abp-object-menuitem").hidden = (nodeType != "OBJECT");
  document.getElementById("abp-frame-menuitem").hidden = (contextMenu.abpFrameData == null);
}

// Bring up the settings dialog for the node the context menu was referring to
function abpNode(data) {
  if (abp && data)
    openDialog("chrome://adblockplus/content/composer.xul", "_blank", "chrome,centerscreen,resizable,dialog=no,dependent", abpGetBrowser().contentWindow, data);
}
