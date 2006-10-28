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

var abp = null;
try {
  abp = Components.classes["@mozilla.org/adblockplus;1"].createInstance();
  while (abp && !("getString" in abp))
    abp = abp.wrappedJSObject;    // Unwrap Adblock Plus component

  if (!abp.prefs.initialized)
    abp = null;
} catch (e) {}

var abpPrefs = abp ? abp.prefs : {enabled: false};
var abpDetachedSidebar = null;
var abpForceDetach = false;
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
  var contextMenu = document.getElementById("contentAreaContextMenu") || document.getElementById("messagePaneContext");
  contextMenu.addEventListener("popupshowing", abpCheckContext, false);

  // Make sure our context menu items are at the bottom
  contextMenu.appendChild(document.getElementById("abp-frame-menuitem"));
  contextMenu.appendChild(document.getElementById("abp-link-menuitem"));
  contextMenu.appendChild(document.getElementById("abp-object-menuitem"));
  contextMenu.appendChild(document.getElementById("abp-image-menuitem"));

  // Check whether Adblock is installed and uninstall
  // Delay it so the browser window will be displayed before the warning
  if (abp && !abpPrefs.checkedadblockinstalled)
    setTimeout(abpCheckExtensionConflicts, 0);

  // Install toolbar button in Firefox if necessary
  if (abp && !abpPrefs.checkedtoolbar)
    setTimeout(abpInstallInToolbar, 0);

  // Let user choose subscriptions on first start
  if (abp && abpPrefs.showsubscriptions)
    setTimeout(abpShowSubscriptions, 0);

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
  }
  var copyMenu = function(to) {
    if (!to || !to.firstChild)
      return;

    to = to.firstChild;
    var from = document.getElementById("abp-status-popup");
    for (var node = from.firstChild; node; node = node.nextSibling)
      to.appendChild(fixId(node.cloneNode(true)));
  }
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
    return null;
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

    if (state == "active") {
      var contentWnd = window.content;
      var location = null;
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
          var emailAddress = headerParser.extractHeaderAddressMailboxes(null, msgHdr.author);
          if (emailAddress) {
            location = 'mailto:' + emailAddress.replace(/^[\s"]+/, "").replace(/[\s"]+$/, "").replace(' ', '%20');
          }
        }
        catch(e) {}
      }
      else {
        // Firefox web page

        location = abp.unwrapURL(window.content.location.href);
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

      if (element.tagName == "statusbarpanel") {
        element.hidden = !abpPrefs.showinstatusbar;

        var labelElement = element.getElementsByTagName("label")[0];
        labelElement.setAttribute("value", label);
      }
      else
        element.hidden = !abpPrefs.showintoolbar;

      // HACKHACK: Show status bar icon in SeaMonkey Mail instead of toolbar icon
      if (element.hidden && element.tagName == "statusbarpanel" && document.getElementById("msgToolbar"))
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
  }

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
      button.setAttribute("popup", button.getAttribute("context"));
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

// Check whether Adblock is installed and uninstall
function abpCheckExtensionConflicts() {
  // Make sure not to run this twice
  abpPrefs.checkedadblockinstalled = true;
  abpPrefs.save();

  if ("@mozilla.org/adblock;1" in Components.classes) {
    var promptService = Components.classes["@mozilla.org/embedcomp/prompt-service;1"]
                                  .getService(Components.interfaces.nsIPromptService);
    // Adblock is installed
    if ("@mozilla.org/extensions/manager;1" in Components.classes) {
      // Extension Manager available, ask whether to uninstall
      var result = promptService.confirm(window, abp.getString("uninstall_adblock_title"),
                                         abp.getString("uninstall_adblock_text"));
      if (!result)
        return;

      try {
        var id = Components.ID("{34274bf4-1d97-a289-e984-17e546307e4f}");
        var extensionManager = Components.classes["@mozilla.org/extensions/manager;1"]
                                         .getService(Components.interfaces.nsIExtensionManager);

        if ('uninstallItem' in extensionManager) {
          // FF 1.1+
          extensionManager.uninstallItem(id);
        }
        else {
          // FF 1.0
          // This seems to fail with the error "this._ds has no properties",
          // but only if the check isn't done immediately after installation.
          extensionManager.uninstallExtension(id);
        }
        promptService.alert(window, abp.getString("uninstall_adblock_title"),
                                    abp.getString("uninstall_adblock_success"));
      }
      catch (e) {
        dump("Adblock Plus: error uninstalling Adblock, " + e + "\n");
        promptService.alert(window, abp.getString("uninstall_adblock_title"),
                                    abp.getString("uninstall_adblock_error"));
      }
    }
    else {
      // No extension manager, recomend manual uninstall
      promptService.alert(window, abp.getString("uninstall_adblock_title"),
                                  abp.getString("uninstall_adblock_manually"));
    }
  }
}

// Check whether we installed the toolbar button already
function abpInstallInToolbar() {
  if (!document.getElementById("abp-toolbarbutton")) {
    var insertBeforeBtn = "urlbar-container";
    var toolbar = document.getElementById("nav-bar");
    if (!toolbar) {
      insertBeforeBtn = "button-junk";
      toolbar = document.getElementById("mail-bar");
    }

    if (toolbar && "insertItem" in toolbar) {
      var insertBefore = document.getElementById(insertBeforeBtn);
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

  // Make sure not to run this twice
  if (!abpPrefs.checkedtoolbar) {
    abpPrefs.checkedtoolbar = true;
    abpPrefs.save();
  }
}

// Let user choose subscriptions on first start unless he has some already
function abpShowSubscriptions() {
  // Make sure not to run this twice
  abpPrefs.showsubscriptions = false;
  abpPrefs.save();

  // Look for existing subscriptions
  for (var i = 0; i < abpPrefs.subscriptions.length; i++)
    if (!abpPrefs.subscriptions[i].special)
      return;

  window.openDialog("chrome://adblockplus/content/tip_subscriptions.xul", "_blank", "chrome,centerscreen,resizable=no,dialog=no");
}

// Retrieves the location of the sidebar panels file (Mozilla Suite/Seamonkey)
function abpGetPanelsFile() {
  var dirService = Components.classes["@mozilla.org/file/directory_service;1"]
                              .getService(Components.interfaces.nsIProperties);
  var file = dirService.get("UPnls", Components.interfaces.nsIFile);
  if (file && !file.exists())
    return null;

  return file;
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
      var data = abp.getDataForWindow(window.content);
      var locations = data.getAllLocations();

      var blocked = 0;
      var filters = new abp.HashTable();
      for (i = 0; i < locations.length; i++) {
        if (locations[i].filter && locations[i].filter.type != "whitelist")
          blocked++;
        if (locations[i].filter) {
          if (locations[i].filter.text in filters)
            filters[locations[i].filter.text].value++;
          else
            filters[locations[i].filter.text] = {value:1};
        }
      }

      var blockedStr = abp.getString("blocked_count_tooltip");
      blockedStr = blockedStr.replace(/--/, blocked).replace(/--/, locations.length);
      document.getElementById("abp-tooltip-blocked").setAttribute("value", blockedStr);

      var filterSort = function(a, b) {
        return filters[b].value - filters[a].value;
      };
      for (var filter in filters)
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
        descr.setAttribute("value", activeFilters[i] + " (" + filters[activeFilters[i]].value + ")");
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
  if (popup.id.indexOf("options") >= 0)
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
      var site = headerParser.extractHeaderAddressMailboxes(null, msgHdr.author);
      if (site)
        site = site.replace(/^[\s"]+/, "").replace(/[\s"]+$/, "");
    }
    catch(e) {
      site = null;
    }

    if (site) {
      whitelistItemSite.pattern = "@@|mailto:" + site.replace(' ', '%20') + "|";
      whitelistItemSite.setAttribute("checked", abpHasPattern(whitelistItemSite.pattern));
      whitelistItemSite.setAttribute("label", whitelistItemSite.getAttribute("labeltempl").replace(/--/, site));
    }
  }
  else {
    // Firefox web page

    location = abp.unwrapURL(content.location.href);
  }

  if (!site && location) {
    if (abp.policy.isBlockableScheme(location)) {
      var url = location.replace(/\?.*/, '');
      var host = abp.makeURL(location);
      if (host)
        host = host.host;
      site = url.replace(/^([^\/]+\/\/[^\/]+\/).*/, "$1");
  
      whitelistItemSite.pattern = "@@|" + site;
      whitelistItemSite.setAttribute("checked", abpHasPattern(whitelistItemSite.pattern));
      whitelistItemSite.setAttribute("label", whitelistItemSite.getAttribute("labeltempl").replace(/--/, host));
  
      whitelistItemPage.pattern = "@@|" + url + "|";
      whitelistItemPage.setAttribute("checked", abpHasPattern(whitelistItemPage.pattern));
    }
    else
      location = null;
  }

  whitelistItemSite.hidden = !site;
  whitelistItemPage.hidden = !location;
  whitelistItemPage.nextSibling.hidden = !site && !location;

  if (abp.getSettingsDialog()) {
    whitelistItemSite.setAttribute("disabled", "true");
    whitelistItemPage.setAttribute("disabled", "true");
  }
  else {
    whitelistItemSite.removeAttribute("disabled");
    whitelistItemPage.removeAttribute("disabled");
  }

  elements.enabled.setAttribute("checked", abpPrefs.enabled);
  elements.localpages.setAttribute("checked", abpPrefs.blocklocalpages);
  elements.frameobjects.setAttribute("checked", abpPrefs.frameobjects);
  elements.slowcollapse.setAttribute("checked", !abpPrefs.fastcollapse);
  elements.linkcheck.setAttribute("checked", abpPrefs.linkcheck);
  elements.showintoolbar.setAttribute("checked", abpPrefs.showintoolbar);
  elements.showinstatusbar.setAttribute("checked", abpPrefs.showinstatusbar);

  var defAction = (popup.tagName == "menupopup" || document.popupNode.id == "abp-toolbarbutton" ? abpPrefs.defaulttoolbaraction : abpPrefs.defaultstatusbaraction);
  elements.opensidebar.setAttribute("default", defAction == 1);
  elements.closesidebar.setAttribute("default", defAction == 1);
  elements.settings.setAttribute("default", defAction == 2);
  elements.enabled.setAttribute("default", defAction == 3);

  return true;
}

function abpIsSidebarOpen() {
  // Test whether detached sidebar window is open
  if (abpDetachedSidebar && !abpDetachedSidebar.closed)
    return true;

  // Test whether sidebar is hidden (pop-up window)
  if (document.documentElement.hasAttribute("chromehidden") && /extrachrome/.test(document.documentElement.getAttribute("chromehidden")))
    return false;

  if ("toggleSidebar" in window)
    return (document.getElementById("viewAdblockPlusSidebar").getAttribute("checked") == "true");
  else if ("SidebarGetLastSelectedPanel" in window) {
    const sidebarURI = "urn:sidebar:3rdparty-panel:adblockplus";
    return (!sidebar_is_hidden() && SidebarGetLastSelectedPanel() == sidebarURI);
  }
  return false;
}

function abpToggleSidebar() {
  var broadcaster = document.getElementById("viewAdblockPlusSidebar");
  if (broadcaster)
    broadcaster.doCommand();
  else
    abpToggleSidebarInternal();
}

function abpToggleSidebarInternal() {
  if (!abp)
    return;

  if (abpIsSidebarOpen()) {
    if (abpDetachedSidebar && !abpDetachedSidebar.closed) {
      // Close detached sidebar
      abpDetachedSidebar.close();
    }
    else if ("toggleSidebar" in window) {
      // Close Firefox sidebar
      toggleSidebar('viewAdblockPlusSidebar');
    }
    else if ("SidebarGetLastSelectedPanel" in window) {
      // Close Mozilla Suite/Seamonkey sidebar
      SidebarShowHide();
    }
  }
  else {
    abpForceDetach = (document.documentElement.hasAttribute("chromehidden") && /extrachrome/.test(document.documentElement.getAttribute("chromehidden")));
    var mustDetach = abpForceDetach || abpPrefs.detachsidebar;

    if (!mustDetach && "toggleSidebar" in window) {
      // Open Firefox sidebar
      toggleSidebar('viewAdblockPlusSidebar');
    }
    else if (!mustDetach && "SidebarGetLastSelectedPanel" in window) {
      // Open Mozilla Suite/Seamonkey sidebar
      const sidebarURI = "urn:sidebar:3rdparty-panel:adblockplus";
      const sidebarTitle = document.getElementById("abp-status").getAttribute("sidebartitle");
      const sidebarURL = "chrome://adblockplus/content/sidebar.xul";
      const sidebarExclude = "composer:html composer:text";
      const prefix = "http://home.netscape.com/NC-rdf#";
      const rootURI = "urn:sidebar:current-panel-list";

      var panelsFile = abpGetPanelsFile();
      if (!panelsFile)
        return;
  
      var ioService = Components.classes["@mozilla.org/network/io-service;1"]
                                .getService(Components.interfaces.nsIIOService); 
      var protHandler = ioService.getProtocolHandler('file')
                                .QueryInterface(Components.interfaces.nsIFileProtocolHandler);
      var panelsURL = protHandler.newFileURI(panelsFile).spec;
  
      var rdfService = Components.classes["@mozilla.org/rdf/rdf-service;1"]
                                .getService(Components.interfaces.nsIRDFService);
      var containerUtils = Components.classes["@mozilla.org/rdf/container-utils;1"]
                                    .getService(Components.interfaces.nsIRDFContainerUtils);
      var datasource = rdfService.GetDataSourceBlocking(panelsURL);
  
      var resource = function(uri) {
        return rdfService.GetResource(uri);
      }
      var literal = function(str) {
        return rdfService.GetLiteral(str);
      }
  
      var seqNode = datasource.GetTarget(resource(rootURI), resource(prefix + "panel-list"), true);
      var sequence = containerUtils.MakeSeq(datasource, seqNode);
      if (sequence.IndexOf(resource(sidebarURI)) < 0) {
        // Sidebar isn't installed yet, have to do it
        datasource.Assert(resource(sidebarURI), resource(prefix + "title"), literal(sidebarTitle), true);
        datasource.Assert(resource(sidebarURI), resource(prefix + "content"), literal(sidebarURL), true);
        datasource.Assert(resource(sidebarURI), resource(prefix + "exclude"), literal(sidebarExclude), true);
        sequence.AppendElement(resource(sidebarURI));
  
        // Refresh sidebar
        datasource.Assert(resource(rootURI), resource(prefix + "refresh"), literal("true"), true);
        datasource.Unassert(resource(rootURI), resource(prefix + "refresh"), literal("true"));
  
        // Save changes
        datasource.QueryInterface(Components.interfaces.nsIRDFRemoteDataSource).Flush();
      }
  
      // Open sidebar panel
      var panel = document.getElementById(sidebarURI);
      if (!panel) {
        SidebarShowHide();
        panel = document.getElementById(sidebarURI);
      }
      if (!panel)
        return;
  
      if (panel.hidden)
        SidebarTogglePanel(panel);
  
      SidebarSelectPanel(panel, true, true);
    }
    else {
      if (!mustDetach)
        abpForceDetach = true;

      // Open detached sidebar
      abpDetachedSidebar = window.openDialog("chrome://adblockplus/content/sidebarDetached.xul", "_blank", "chrome,resizable,dependent,dialog=no,width=300,height=600");
    }
  }
}

// Checks whether the specified pattern exists in the list
function abpHasPattern(pattern) {
  for (var i = 0; i < abpPrefs.userPatterns.length; i++)
    if (abpPrefs.userPatterns[i].text == pattern)
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

  var found = false;
  for (var i = 0; i < abpPrefs.userPatterns.length; i++) {
    if (abpPrefs.userPatterns[i].text == text) {
      if (insert)
        found = true;
      else
        abpPrefs.userPatterns.splice(i--, 1);
    }
  }
  if (!found && insert) {
    var pattern = abpPrefs.patternFromText(text);
    if (pattern)
      abpPrefs.userPatterns.push(pattern);
  }

  abpPrefs.initMatching();
  abpPrefs.savePatterns();

  // Make sure to display whitelisting immediately
  abpReloadPrefs();
}

// Handle clicks on the Adblock statusbar panel
function abpClickHandler(e) {
  if (e.button == 0 && new Date().getTime() - abpLastDrag > 100)
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
    abpSettings();
  else if (action == 3)
    abpTogglePref("enabled");
}

// Handles Drag&Drop of links and images to the Adblock statusbar panel
function abpDragHandler(e) {
  if (!abp)
    return;

  var dragService = Components.classes['@mozilla.org/widget/dragservice;1']
                              .getService(Components.interfaces.nsIDragService);
  var session = dragService.getCurrentSession();
  if (!session)
    return;

  var link = null;
  for (var node = new XPCNativeWrapper(session.sourceNode); node && !link; node = node.parentNode) {
    if (node instanceof HTMLAnchorElement)
      link = abp.unwrapURL(node.href);
    else if (node instanceof HTMLImageElement)
      link = abp.unwrapURL(node.src);
  }

  if (e.type == "dragover")
    session.canDrop = (link != null);
  else if (link)
    abpSettings(link);

  e.preventDefault();
  e.stopPropagation();
}

var abpDraggingX = -1;
var abpLastDrag = -1;

// Allows activating/deactivating with a drag gesture on the Adblock status bar item
function abpMouseHandler(e) {
  if (!abp || e.button != 0)
    return;

  if (e.type == "mousedown") {
    abpDraggingX = e.clientX;
    e.target.addEventListener("mouseup", abpMouseHandler, false);
    e.target.addEventListener("mouseout", abpMouseHandler, false);
  }
  else if (e.type == "mouseout" || e.type == "mouseup") {
    e.target.removeEventListener("mouseup", abpMouseHandler, false);
    e.target.removeEventListener("mouseout", abpMouseHandler, false);
    if (e.type == "mouseup" && abpDraggingX >= 0 && Math.abs(e.clientX - abpDraggingX) > 10) {
      abpPrefs.enabled = !abpPrefs.enabled;
      abpPrefs.save();
      abpLastDrag = new Date().getTime();
    }
    abpDraggingX = -1;
  }
}

// Retrieves the image URL for the specified style property
function abpImageStyle(computedStyle, property) {
  var value = computedStyle.getPropertyCSSValue(property);
  if (value.primitiveType == CSSPrimitiveValue.CSS_URI)
    return abp.unwrapURL(value.getStringValue());

  return null;
}

// Hides the unnecessary context menu items on display
function abpCheckContext() {
  var target = new XPCNativeWrapper(gContextMenu.target);

  var nodeType = null;
  gContextMenu.abpLinkData = null;
  gContextMenu.abpBgData = null;
  gContextMenu.abpFrameData = null;
  if (abp) {
    // Lookup the node in our stored data
    var data = abp.getDataForNode(target);
    gContextMenu.abpData = data;
    if (data && !data.filter)
      nodeType = data.typeDescr;

    var wnd = target.ownerDocument.defaultView;
    var wndData = abp.getDataForWindow(wnd);

    gContextMenu.abpFrameData = abp.getDataForNode(wnd);
    if (gContextMenu.abpFrameData && gContextMenu.abpFrameData.filter)
      gContextMenu.abpFrameData = null;

    if (abpPrefs.linkcheck && nodeType && abp.policy.shouldCheckLinks(data.type)) {
      // Look for a parent link
      var linkNode = target;
      while (linkNode && !gContextMenu.abpLinkData) {
        if ("href" in linkNode) {
          var link = abp.unwrapURL(linkNode.href);
          if (link) {
            gContextMenu.abpLinkData = wndData.getLocation(link);
            if (gContextMenu.abpLinkData && gContextMenu.abpLinkData.filter)
              gContextMenu.abpLinkData = null;
          }
        }

        linkNode = linkNode.parentNode;
      }

      if (linkNode)
        gContextMenu.abpLink = abp.unwrapURL(linkNode.href);
    }

    if (nodeType != "IMAGE") {
      // Look for a background image
      var imageNode = target;
      while (imageNode && !gContextMenu.abpBgData) {
        if (imageNode.nodeType == Node.ELEMENT_NODE) {
          var bgImage = null;
          var style = wnd.getComputedStyle(imageNode, "");
          bgImage = abpImageStyle(style, "background-image") || abpImageStyle(style, "list-style-image");
          if (bgImage) {
            gContextMenu.abpBgData = wndData.getLocation(bgImage);
            if (gContextMenu.abpBgData && gContextMenu.abpBgData.filter)
              gContextMenu.abpBgData = null;
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

  gContextMenu.showItem('abp-image-menuitem', nodeType == "IMAGE" || gContextMenu.abpBgData != null);
  gContextMenu.showItem('abp-object-menuitem', nodeType == "OBJECT");
  gContextMenu.showItem('abp-link-menuitem', gContextMenu.abpLinkData != null);
  gContextMenu.showItem("abp-frame-menuitem", gContextMenu.abpFrameData != null);
}

// Bring up the settings dialog for the node the context menu was referring to
function abpNode(data) {
  if (data)
    abpSettings(data.location);
}

// Open the settings window.
function abpSettings(url) {
  if (!abp)
    return;

  abp.openSettingsDialog(abpGetBrowser().contentWindow, url);
}
