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
 * Portions created by the Initial Developer are Copyright (C) 2006-2010
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * ***** END LICENSE BLOCK ***** */

Cu.import("resource://gre/modules/XPCOMUtils.jsm");

var RequestList = abp.RequestList;

/**
 * List of event handers to be registered. For each event handler the element ID,
 * event and the actual event handler are listed.
 * @type Array
 */
let eventHandlers = [
  ["abp-tooltip", "popupshowing", abpFillTooltip],
  ["abp-status-popup", "popupshowing", abpFillPopup],
  ["abp-toolbar-popup", "popupshowing", abpFillPopup],
  ["abp-command-settings", "command", function() { abp.openSettingsDialog(); }],
  ["abp-command-sidebar", "command", toggleSidebar],
  ["abp-command-togglesitewhitelist", "command", function() { toggleFilter(siteWhitelist); }],
  ["abp-command-togglepagewhitelist", "command", function() { toggleFilter(pageWhitelist); }],
  ["abp-command-toggleobjtabs", "command", function() { abpTogglePref("frameobjects"); }],
  ["abp-command-togglecollapse", "command", function() { abpTogglePref("fastcollapse"); }],
  ["abp-command-toggleshowintoolbar", "command", function() { abpTogglePref("showintoolbar"); }],
  ["abp-command-toggleshowinstatusbar", "command", function() { abpTogglePref("showinstatusbar"); }],
  ["abp-command-enable", "command", function() { abpTogglePref("enabled"); }],
  ["abp-status", "click", abpClickHandler],
  ["abp-toolbarbutton", "command", function(event) { if (event.eventPhase == event.AT_TARGET) abpCommandHandler(event); }],
  ["abp-toolbarbutton", "click", function(event) { if (event.eventPhase == event.AT_TARGET && event.button == 1) abpTogglePref("enabled"); }],
  ["abp-image-menuitem", "command", function() { abpNode(backgroundData || nodeData); }],
  ["abp-object-menuitem", "command", function() { abpNode(nodeData); }],
  ["abp-media-menuitem", "command", function() { abpNode(nodeData); }],
  ["abp-frame-menuitem", "command", function() { abpNode(frameData); }],
  ["abp-removeWhitelist-menuitem", "command", function() { removeWhitelist(); }]
];

/**
 * Stores the current value of showintoolbar preference (to detect changes).
 */
let currentlyShowingInToolbar = prefs.showintoolbar;

/**
 * Filter corresponding with "disable on site" menu item (set in abpFillPopup()).
 * @type Filter
 */
let siteWhitelist = null;
/**
 * Filter corresponding with "disable on site" menu item (set in abpFillPopup()).
 * @type Filter
 */
let pageWhitelist = null;

/**
 * Data associated with the node currently under mouse pointer (set in abpCheckContext()).
 */
let nodeData = null;
/**
 * Data associated with the background image currently under mouse pointer (set in abpCheckContext()).
 */
let backgroundData = null;
/**
 * Data associated with the frame currently under mouse pointer (set in abpCheckContext()).
 */
let frameData = null;

/**
 * Progress listener detecting location changes and triggering status updates.
 * @type nsIWebProgress
 */
let progressListener = null;

/**
 * Object implementing app-specific methods.
 */
let abpHooks = E("abp-hooks");

/**
 * Window of the detached list of blockable items (might be null or closed).
 * @type nsIDOMWindow 
 */
let detachedSidebar = null;

abpInit();

function abpInit() {
  // Initialize app hooks
  for each (let hook in ["getBrowser", "addTab", "getContextMenu", "getToolbox", "getDefaultToolbar", "toolbarInsertBefore"])
  {
    let handler = abpHooks.getAttribute(hook);
    if (handler)
      abpHooks[hook] = new Function(handler);
  }
  abpHooks.initObjTab = function(objTab)
  {
    objTab.addEventListener("click", function(event)
    {
      if (event.isTrusted && event.button == 0)
      {
        event.preventDefault();
        event.stopPropagation();
        abpNode(objTab.nodeData);
      }
    }, true);
  };

  // Process preferences
  abpReloadPrefs();

  // Copy the menu from status bar icon to the toolbar
  function fixId(node)
  {
    if (node.nodeType != node.ELEMENT_NODE)
      return node;

    if ("id" in node && node.id)
      node.id = node.id.replace(/abp-status/, "abp-toolbar");

    for (var child = node.firstChild; child; child = child.nextSibling)
      fixId(child);

    return node;
  }
  function copyMenu(to)
  {
    if (!to || !to.firstChild)
      return;

    to = to.firstChild;
    var from = E("abp-status-popup");
    for (var node = from.firstChild; node; node = node.nextSibling)
      to.appendChild(fixId(node.cloneNode(true)));
  }
  let paletteButton = abpGetPaletteButton();
  copyMenu(E("abp-toolbarbutton"));
  if (paletteButton != E("abp-toolbarbutton"))
    copyMenu(paletteButton);

  // Palette button elements aren't reachable by ID, create a lookup table
  let paletteButtonIDs = {};
  if (paletteButton)
  {
    function getElementIds(element)
    {
      if (element.hasAttribute("id"))
        paletteButtonIDs[element.getAttribute("id")] = element;

      for (let child = element.firstChild; child; child = child.nextSibling)
        if (child.nodeType == Ci.nsIDOMNode.ELEMENT_NODE)
          getElementIds(child);
    }
    getElementIds(paletteButton);
  }

  // Register event listeners
  window.addEventListener("unload", abpUnload, false);
  for each (let [id, event, handler] in eventHandlers)
  {
    let element = E(id);
    if (element)
      element.addEventListener(event, handler, false);

    if (id in paletteButtonIDs)
      paletteButtonIDs[id].addEventListener(event, handler, false);
  }

  prefs.addListener(abpReloadPrefs);
  filterStorage.addFilterObserver(abpReloadPrefs);
  filterStorage.addSubscriptionObserver(abpReloadPrefs);

  let browser = abpHooks.getBrowser();
  browser.addEventListener("click", handleLinkClick, true);

  let dummy = function() {};
  let progressListener = {
    onLocationChange: abpReloadPrefs,
    onProgressChange: dummy,
    onSecurityChange: dummy,
    onStateChange: dummy,
    onStatusChange: dummy,
    QueryInterface: XPCOMUtils.generateQI([Ci.nsIWebProgressListener, Ci.nsISupportsWeakReference])
  };
  browser.addProgressListener(progressListener);

  // Make sure we always configure keys but don't let them break anything
  try {
    // Configure keys
    for (var key in prefs)
      if (key.match(/(.*)_key$/))
        abpConfigureKey(RegExp.$1, prefs[key]);
  } catch(e) {}

  // Install context menu handler
  var contextMenu = abpHooks.getContextMenu();
  if (contextMenu)
  {
    contextMenu.addEventListener("popupshowing", abpCheckContext, false);
  
    // Make sure our context menu items are at the bottom
    contextMenu.appendChild(E("abp-removeWhitelist-menuitem"));
    contextMenu.appendChild(E("abp-frame-menuitem"));
    contextMenu.appendChild(E("abp-object-menuitem"));
    contextMenu.appendChild(E("abp-media-menuitem"));
    contextMenu.appendChild(E("abp-image-menuitem"));
  }

  // First run actions
  if (!("doneFirstRunActions" in prefs))
  {
    // Don't repeat first run actions if new window is opened
    prefs.doneFirstRunActions = true;

    // Show subscriptions dialog if the user doesn't have any subscriptions yet
    if (prefs.lastVersion != prefs.currentVersion)
    {
      if ("nsISessionStore" in Ci)
      {
        // Have to wait for session to be restored
        let observer = {
          QueryInterface: XPCOMUtils.generateQI([Ci.nsIObserver]),
          observe: function(subject, topic, data)
          {
            observerService.removeObserver(observer, "sessionstore-windows-restored");
            timer.cancel();
            timer = null;
            showSubscriptions();
          }
        };

        let observerService = Cc["@mozilla.org/observer-service;1"].getService(Ci.nsIObserverService);
        observerService.addObserver(observer, "sessionstore-windows-restored", false);

        // Just in case, don't wait more than a second
        let timer = Cc['@mozilla.org/timer;1'].createInstance(Ci.nsITimer);
        timer.init(observer, 1000, Ci.nsITimer.TYPE_ONE_SHOT);
      }
      else
        abp.runAsync(showSubscriptions);
    }
  }

  // Window-specific first run actions
  if (!("doneFirstRunActions " + window.location.href in prefs))
  {
    // Don't repeat first run actions for this window any more
    prefs["doneFirstRunActions " + window.location.href] = true;

    let lastVersion = abpHooks.getAttribute("currentVersion") || "0.0";
    if (lastVersion != prefs.currentVersion)
    {
      abpHooks.setAttribute("currentVersion", prefs.currentVersion);
      document.persist("abp-hooks", "currentVersion");

      let needInstall = (abp.versionComparator.compare(lastVersion, "0.0") <= 0);
      if (!needInstall)
      {
        // Before version 1.1 we didn't add toolbar icon in SeaMonkey, do it now
        needInstall = abp.versionComparator.compare(lastVersion, "1.1") < 0 &&
                      Cc["@mozilla.org/xre/app-info;1"].getService(Ci.nsIXULAppInfo).ID == "{92650c4d-4b8e-4d2a-b7eb-24ecf4f6b63a}";
      }

      // Add ABP icon to toolbar if necessary
      if (needInstall)
        abp.runAsync(abpInstallInToolbar);
    }
  }

  // Some people actually switch off browser.frames.enabled and are surprised
  // that things stop working...
  window.QueryInterface(Ci.nsIInterfaceRequestor)
        .getInterface(Ci.nsIWebNavigation)
        .QueryInterface(Ci.nsIDocShell)
        .allowSubframes = true;
}

function abpUnload()
{
  prefs.removeListener(abpReloadPrefs);
  filterStorage.removeFilterObserver(abpReloadPrefs);
  filterStorage.removeSubscriptionObserver(abpReloadPrefs);
  abpHooks.getBrowser().removeProgressListener(progressListener);
}

function abpReloadPrefs() {
  var state = (prefs.enabled ? "active" : "disabled");

  if (state == "active")
  {
    let location = getCurrentLocation();
    if (location && abp.policy.isWhitelisted(location.spec, "DOCUMENT"))
      state = "whitelisted";
  }

  var tooltip = E("abp-tooltip");
  if (state && tooltip)
    tooltip.setAttribute("curstate", state);

  var updateElement = function(element) {
    if (!element)
      return;

    if (element.tagName == "statusbarpanel")
      element.hidden = !prefs.showinstatusbar;
    else
      element.hidden = !prefs.showintoolbar;

    // HACKHACK: Show status bar icon instead of toolbar icon if the application doesn't have a toolbar icon
    if (element.hidden && element.tagName == "statusbarpanel" && !abpHooks.getDefaultToolbar)
      element.hidden = !prefs.showintoolbar;

    if (currentlyShowingInToolbar != prefs.showintoolbar)
      abpInstallInToolbar();

    currentlyShowingInToolbar = prefs.showintoolbar;

    element.setAttribute("abpstate", state);
  };

  var status = E("abp-status");
  updateElement(status);
  if (status) {
    if (prefs.defaultstatusbaraction == 0)
      status.setAttribute("popup", status.getAttribute("context"));
    else
      status.removeAttribute("popup");
  }
  
  var button = E("abp-toolbarbutton");
  updateElement(button);
  if (button) {
    if (button.hasAttribute("context") && prefs.defaulttoolbaraction == 0)
    {
      button.setAttribute("popup", button.getAttribute("context"));
      button.removeAttribute("type");
    }
    else
      button.removeAttribute("popup");
  }

  updateElement(abpGetPaletteButton());
}

/**
 * Tests whether image manager context menu entry should be hidden with user's current preferences.
 * @return Boolean
 */
function shouldHideImageManager()
{
  let result = false;
  if (prefs.hideimagemanager && "@mozilla.org/permissionmanager;1" in Cc)
  {
    try
    {
      result = true;
      let enumerator = Cc["@mozilla.org/permissionmanager;1"].getService(Ci.nsIPermissionManager).enumerator;
      while (enumerator.hasMoreElements())
      {
        let item = enumerator.getNext().QueryInterface(Ci.nsIPermission);
        if (item.type == "image" && item.capability == Ci.nsIPermissionManager.DENY_ACTION)
        {
          result = false;
          break;
        }
      }
    }
    catch(e)
    {
      result = false;
    }
  }

  shouldHideImageManager = function() result;
  return result;
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

  var command = E("abp-command-" + key);
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
    else if ("DOM_VK_" + parts[i].toUpperCase() in Ci.nsIDOMKeyEvent)
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

    E("abp-keyset").appendChild(element);
  }
}

/**
 * Handles browser clicks to intercept clicks on abp: links.
 */
function handleLinkClick(/**Event*/ event)
{
  // Ignore right-clicks
  if (event.button == 2)
    return;

  // Search the link associated with the click
  let link = event.target;
  while (link && !(link instanceof Ci.nsIDOMNSHTMLAnchorElement))
    link = link.parentNode;

  if (!link || !/^abp:\/*subscribe\/*\?(.*)/i.test(link.href))  /**/
    return;

  // This is our link - make sure the browser doesn't handle it
  event.preventDefault();
  event.stopPropagation();

  // Decode URL parameters
  let title = null;
  let url = null;
  let mainSubscriptionTitle = null;
  let mainSubscriptionURL = null;
  for each (let param in RegExp.$1.split('&'))
  {
    let parts = param.split("=", 2);
    if (parts.length != 2 || !/\S/.test(parts[1]))
      continue;
    switch (parts[0])
    {
      case "title":
        title = decodeURIComponent(parts[1]);
        break;
      case "location":
        url = decodeURIComponent(parts[1]);
        break;
      case "requiresTitle":
        mainSubscriptionTitle = decodeURIComponent(parts[1]);
        break;
      case "requiresLocation":
        mainSubscriptionURL = decodeURIComponent(parts[1]);
        break;
    }
  }
  if (!url)
    return;

  // Default title to the URL
  if (!title)
    title = url;

  // Main subscription needs both title and URL
  if (mainSubscriptionTitle && !mainSubscriptionURL)
    mainSubscriptionTitle = null;
  if (mainSubscriptionURL && !mainSubscriptionTitle)
    mainSubscriptionURL = null;

  // Trim spaces in title and URL
  title = title.replace(/^\s+/, "").replace(/\s+$/, "");
  url = url.replace(/^\s+/, "").replace(/\s+$/, "");
  if (mainSubscriptionURL)
  {
    mainSubscriptionTitle = mainSubscriptionTitle.replace(/^\s+/, "").replace(/\s+$/, "");
    mainSubscriptionURL = mainSubscriptionURL.replace(/^\s+/, "").replace(/\s+$/, "");
  }

  // Verify that the URL is valid
  url = abp.makeURL(url);
  if (!url || (url.scheme != "http" && url.scheme != "https" && url.scheme != "ftp"))
    return;
  url = url.spec;

  if (mainSubscriptionURL)
  {
    mainSubscriptionURL = abp.makeURL(mainSubscriptionURL);
    if (!mainSubscriptionURL || (mainSubscriptionURL.scheme != "http" && mainSubscriptionURL.scheme != "https" && mainSubscriptionURL.scheme != "ftp"))
      mainSubscriptionURL = mainSubscriptionTitle = null;
    else
      mainSubscriptionURL = mainSubscriptionURL.spec;
  }

  // Open dialog
  if (!isFennec)
  {
    var subscription = {url: url, title: title, disabled: false, external: false, autoDownload: true,
                        mainSubscriptionTitle: mainSubscriptionTitle, mainSubscriptionURL: mainSubscriptionURL};
    window.openDialog("chrome://adblockplus/content/ui/subscriptionSelection.xul", "_blank",
                     "chrome,centerscreen,resizable,dialog=no", subscription, null);
  }
  else
  {
    // Special handling for Fennec
    window.importDialog(null, "chrome://adblockplus/content/ui/fennecSubscription.xul");
    initFennecSubscriptionDialog(url, title);
  }
}

// Finds the toolbar button in the toolbar palette
function abpGetPaletteButton()
{
  let toolbox = (abpHooks.getToolbox ? abpHooks.getToolbox() : null);
  if (!toolbox || !("palette" in toolbox) || !toolbox.palette)
    return null;

  for (var child = toolbox.palette.firstChild; child; child = child.nextSibling)
    if (child.id == "abp-toolbarbutton")
      return child;

  return null;
}

// Check whether we installed the toolbar button already
function abpInstallInToolbar()
{
  let tb = E("abp-toolbarbutton");
  if (!tb || tb.parentNode.localName == "toolbarpalette")
  {
    let toolbar = (abpHooks.getDefaultToolbar ? abpHooks.getDefaultToolbar() : null);
    let insertBefore = (abpHooks.toolbarInsertBefore ? abpHooks.toolbarInsertBefore() : null);
    if (toolbar && "insertItem" in toolbar)
    {
      if (insertBefore && insertBefore.parentNode != toolbar)
        insertBefore = null;

      toolbar.insertItem("abp-toolbarbutton", insertBefore, null, false);

      toolbar.setAttribute("currentset", toolbar.currentSet);
      document.persist(toolbar.id, "currentset");
    }
  }
}

/**
 * Executed on first run, presents the user with a list of filter subscriptions
 * and allows choosing one.
 */
function showSubscriptions()
{
  // In Fennec we might not be initialized yet
  abp.init();

  // Don't annoy the user if he has a subscription already
  let hasSubscriptions = filterStorage.subscriptions.some(function(subscription) subscription instanceof abp.DownloadableSubscription);
  if (hasSubscriptions)
    return;

  // Only show the list if this is the first run or the user has no filters
  let hasFilters = filterStorage.subscriptions.some(function(subscription) subscription.filters.length);
  if (hasFilters && abp.versionComparator.compare(prefs.lastVersion, "0.0") > 0)
    return;

  if (!abpHooks.addTab || abpHooks.addTab("chrome://adblockplus/content/ui/subscriptionSelection.xul") === false)
    window.openDialog("chrome://adblockplus/content/ui/subscriptionSelection.xul", "_blank", "chrome,centerscreen,resizable,dialog=no");
}

function abpFillTooltip(event)
{
  if (!document.tooltipNode || !document.tooltipNode.hasAttribute("tooltip"))
  {
    event.preventDefault();
    return;
  }

  let type = (document.tooltipNode && document.tooltipNode.id == "abp-toolbarbutton" ? "toolbar" : "statusbar");
  let action = parseInt(prefs["default" + type + "action"]);
  if (isNaN(action))
    action = -1;

  let actionDescr = E("abp-tooltip-action");
  actionDescr.hidden = (action < 0 || action > 3);
  if (!actionDescr.hidden)
    actionDescr.setAttribute("value", abp.getString("action" + action + "_tooltip"));

  let state = event.target.getAttribute("curstate");
  let statusDescr = E("abp-tooltip-status");
  let statusStr = abp.getString(state + "_tooltip");
  if (state == "active")
  {
    let [activeSubscriptions, activeFilters] = abp.filterStorage.subscriptions.reduce(function([subscriptions, filters], current)
    {
      if (current instanceof abp.SpecialSubscription)
        return [subscriptions, filters + current.filters.length];
      else
        return [subscriptions + 1, filters];
    }, [0, 0]);

    statusStr = statusStr.replace(/--/, activeSubscriptions).replace(/--/, activeFilters);
  }
  statusDescr.setAttribute("value", statusStr);

  let activeFilters = [];
  E("abp-tooltip-blocked-label").hidden = (state != "active");
  E("abp-tooltip-blocked").hidden = (state != "active");
  if (state == "active")
  {
    let data = RequestList.getDataForWindow(abpHooks.getBrowser().contentWindow);

    let itemsCount = 0;
    let blocked = 0;
    let hidden = 0;
    let whitelisted = 0;
    let filterCount = {__proto__: null};
    for each (let location in data.getAllLocations())
    {
      let filter = location.filter;
      if (filter && filter instanceof abp.ElemHideFilter)
        hidden++;
      else
        itemsCount++;

      if (filter)
      {
        if (filter instanceof abp.BlockingFilter)
          blocked++;
        else if (filter instanceof abp.WhitelistFilter)
          whitelisted++;

        if (filter.text in filterCount)
          filterCount[filter.text]++;
        else
          filterCount[filter.text] = 1;
      }
    }

    let blockedStr = abp.getString("blocked_count_tooltip");
    blockedStr = blockedStr.replace(/--/, blocked).replace(/--/, itemsCount);

    if (whitelisted + hidden)
    {
      blockedStr += " " + abp.getString("blocked_count_addendum");
      blockedStr = blockedStr.replace(/--/, whitelisted).replace(/--/, hidden);
    }

    E("abp-tooltip-blocked").setAttribute("value", blockedStr);

    let filterSort = function(a, b)
    {
      return filterCount[b] - filterCount[a];
    };
    for (let filter in filterCount)
      activeFilters.push(filter);
    activeFilters = activeFilters.sort(filterSort);

    if (activeFilters.length > 0)
    {
      let filtersContainer = E("abp-tooltip-filters");
      while (filtersContainer.firstChild)
        filtersContainer.removeChild(filtersContainer.firstChild);
  
      for (let i = 0; i < activeFilters.length && i < 3; i++)
      {
        let descr = document.createElement("description");
        descr.setAttribute("value", activeFilters[i] + " (" + filterCount[activeFilters[i]] + ")");
        filtersContainer.appendChild(descr);
      }
      if (activeFilters.length > 3)
      {
        let descr = document.createElement("description");
        descr.setAttribute("value", "...");
        filtersContainer.appendChild(descr);
      }
    }
  }

  E("abp-tooltip-filters-label").hidden = (activeFilters.length == 0);
  E("abp-tooltip-filters").hidden = (activeFilters.length == 0);
}

/**
 * Retrieves the current location of the browser (might return null on failure).
 */
function getCurrentLocation() /**nsIURI*/
{
  if ("currentHeaderData" in window && "content-base" in window.currentHeaderData)
  {
    // Thunderbird blog entry
    return abp.unwrapURL(window.currentHeaderData["content-base"].headerValue);
  }
  else if ("currentHeaderData" in window && "from" in window.currentHeaderData)
  {
    // Thunderbird mail/newsgroup entry
    try
    {
      let headerParser = Cc["@mozilla.org/messenger/headerparser;1"].getService(Ci.nsIMsgHeaderParser);
      let emailAddress = headerParser.extractHeaderAddressMailboxes(window.currentHeaderData.from.headerValue);
      return abp.makeURL("mailto:" + emailAddress.replace(/^[\s"]+/, "").replace(/[\s"]+$/, "").replace(/\s/g, "%20"));
    }
    catch(e)
    {
      return null;
    }
  }
  else
  {
    // Regular browser
    return abp.unwrapURL(abpHooks.getBrowser().contentWindow.location.href);
  }
}

// Fills the context menu on the status bar
function abpFillPopup(event) {
  let popup = event.target;

  // Not at-target call, ignore
  if (popup.getAttribute("id").indexOf("options") >= 0)
    return;

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
  whitelistItemSite.hidden = whitelistItemPage.hidden = true;

  var whitelistSeparator = whitelistItemPage.nextSibling;
  while (whitelistSeparator.nodeType != whitelistSeparator.ELEMENT_NODE)
    whitelistSeparator = whitelistSeparator.nextSibling;

  let location = getCurrentLocation();
  if (location && abp.policy.isBlockableScheme(location))
  {
    let host = null;
    try
    {
      host = location.host.replace(/^www\./, "");
    } catch (e) {}

    if (host)
    {
      let ending = "|";
      if (location instanceof Ci.nsIURL && location.ref)
        location.ref = "";
      if (location instanceof Ci.nsIURL && location.query)
      {
        location.query = "";
        ending = "?";
      }

      siteWhitelist = abp.Filter.fromText("@@||" + host + "^$document");
      whitelistItemSite.setAttribute("checked", siteWhitelist.subscriptions.length && !siteWhitelist.disabled);
      whitelistItemSite.setAttribute("label", whitelistItemSite.getAttribute("labeltempl").replace(/--/, host));
      whitelistItemSite.hidden = false;

      pageWhitelist = abp.Filter.fromText("@@|" + location.spec + ending + "$document");
      whitelistItemPage.setAttribute("checked", pageWhitelist.subscriptions.length && !pageWhitelist.disabled);
      whitelistItemPage.hidden = false;
    }
    else
    {
      siteWhitelist = abp.Filter.fromText("@@|" + location.spec + "|");
      whitelistItemSite.setAttribute("checked", siteWhitelist.subscriptions.length && !siteWhitelist.disabled);
      whitelistItemSite.setAttribute("label", whitelistItemSite.getAttribute("labeltempl").replace(/--/, location.spec.replace(/^mailto:/, "")));
      whitelistItemSite.hidden = false;
    }
  }
  whitelistSeparator.hidden = whitelistItemSite.hidden && whitelistItemPage.hidden;

  elements.enabled.setAttribute("checked", prefs.enabled);
  elements.frameobjects.setAttribute("checked", prefs.frameobjects);
  elements.slowcollapse.setAttribute("checked", !prefs.fastcollapse);
  elements.showintoolbar.setAttribute("checked", prefs.showintoolbar);
  elements.showinstatusbar.setAttribute("checked", prefs.showinstatusbar);

  var defAction = (popup.tagName == "menupopup" || document.popupNode.id == "abp-toolbarbutton" ? prefs.defaulttoolbaraction : prefs.defaultstatusbaraction);
  elements.opensidebar.setAttribute("default", defAction == 1);
  elements.closesidebar.setAttribute("default", defAction == 1);
  elements.settings.setAttribute("default", defAction == 2);
  elements.enabled.setAttribute("default", defAction == 3);
}

function abpIsSidebarOpen() {
  // Test whether detached sidebar window is open
  if (detachedSidebar && !detachedSidebar.closed)
    return true;

  var sidebar = E("abp-sidebar");
  return (sidebar ? !sidebar.hidden : false);
}

function toggleSidebar()
{
  if (detachedSidebar && !detachedSidebar.closed)
  {
    detachedSidebar.close();
    detachedSidebar = null;
  }
  else
  {
    var sidebar = E("abp-sidebar");
    if (sidebar && (!prefs.detachsidebar || !sidebar.hidden))
    {
      E("abp-sidebar-splitter").hidden = !sidebar.hidden;
      E("abp-sidebar-browser").setAttribute("src", sidebar.hidden ? "chrome://adblockplus/content/ui/sidebar.xul" : "about:blank");
      sidebar.hidden = !sidebar.hidden;
      if (sidebar.hidden)
        abpHooks.getBrowser().contentWindow.focus();
    }
    else
      detachedSidebar = window.openDialog("chrome://adblockplus/content/ui/sidebarDetached.xul", "_blank", "chrome,resizable,dependent,dialog=no");
  }

  let menuItem = E("abp-blockableitems");
  if (menuItem)
    menuItem.setAttribute("checked", abpIsSidebarOpen());
}

// Toggles the value of a boolean pref
function abpTogglePref(pref) {
  prefs[pref] = !prefs[pref];
  prefs.save();
}

/**
 * If the given filter is already in user's list, removes it from the list. Otherwise adds it.
 */
function toggleFilter(/**Filter*/ filter)
{
  if (filter.subscriptions.length)
  {
    if (filter.disabled || filter.subscriptions.some(function(subscription) !(subscription instanceof abp.SpecialSubscription)))
    {
      filter.disabled = !filter.disabled;
      filterStorage.triggerFilterObservers(filter.disabled ? "disable" : "enable", [filter]);
    }
    else
      filterStorage.removeFilter(filter);
  }
  else
    filterStorage.addFilter(filter);
  filterStorage.saveToDisk();
}

/**
 * Removes/disable the exception rule applying for the current page.
 */
function removeWhitelist()
{
  let location = getCurrentLocation();
  let filter = null;
  if (location)
    filter = abp.policy.isWhitelisted(location.spec, "DOCUMENT");
  if (filter && filter.subscriptions.length && !filter.disabled)
    toggleFilter(filter);
}

// Handle clicks on the Adblock statusbar panel
function abpClickHandler(e) {
  if (e.button == 0)
    abpExecuteAction(prefs.defaultstatusbaraction);
  else if (e.button == 1)
    abpTogglePref("enabled");
}

function abpCommandHandler(e) {
  if (prefs.defaulttoolbaraction == 0)
    e.target.open = true;
  else
    abpExecuteAction(prefs.defaulttoolbaraction);
}

// Executes default action for statusbar/toolbar by its number
function abpExecuteAction(action) {
  if (action == 1)
    toggleSidebar();
  else if (action == 2)
    abp.openSettingsDialog();
  else if (action == 3)
    abpTogglePref("enabled");
}

// Retrieves the image URL for the specified style property
function abpImageStyle(computedStyle, property) {
  var value = computedStyle.getPropertyCSSValue(property);
  if (value instanceof Ci.nsIDOMCSSValueList && value.length >= 1)
    value = value[0];
  if (value instanceof Ci.nsIDOMCSSPrimitiveValue && value.primitiveType == Ci.nsIDOMCSSPrimitiveValue.CSS_URI)
    return abp.unwrapURL(value.getStringValue()).spec;

  return null;
}

// Hides the unnecessary context menu items on display
function abpCheckContext() {
  var contextMenu = abpHooks.getContextMenu();
  var target = document.popupNode;

  var nodeType = null;
  backgroundData = null;
  frameData = null;
  if (target) {
    // Lookup the node in our stored data
    var data = RequestList.getDataForNode(target);
    var targetNode = null;
    if (data) {
      targetNode = data[0];
      data = data[1];
    }
    nodeData = data;
    if (data && !data.filter)
      nodeType = data.typeDescr;

    var wnd = (target ? target.ownerDocument.defaultView : null);
    var wndData = (wnd ? RequestList.getDataForWindow(wnd) : null);

    if (wnd.frameElement)
      frameData = RequestList.getDataForNode(wnd.frameElement, true);
    if (frameData)
      frameData = frameData[1];
    if (frameData && frameData.filter)
      frameData = null;

    if (nodeType != "IMAGE") {
      // Look for a background image
      var imageNode = target;
      while (imageNode && !backgroundData) {
        if (imageNode.nodeType == imageNode.ELEMENT_NODE) {
          var bgImage = null;
          var style = wnd.getComputedStyle(imageNode, "");
          bgImage = abpImageStyle(style, "background-image") || abpImageStyle(style, "list-style-image");
          if (bgImage) {
            backgroundData = wndData.getLocation(abp.policy.type.BACKGROUND, bgImage);
            if (backgroundData && backgroundData.filter)
              backgroundData = null;
          }
        }

        imageNode = imageNode.parentNode;
      }
    }

    // Hide "Block Images from ..." if hideimagemanager pref is true and the image manager isn't already blocking something
    var imgManagerContext = E("context-blockimage");
    if (imgManagerContext && shouldHideImageManager())
    {
      // Don't use "hidden" attribute - it might be overridden by the default popupshowing handler
      imgManagerContext.collapsed = true;
    }
  }

  E("abp-image-menuitem").hidden = (nodeType != "IMAGE" && backgroundData == null);
  E("abp-object-menuitem").hidden = (nodeType != "OBJECT");
  E("abp-media-menuitem").hidden = (nodeType != "MEDIA");
  E("abp-frame-menuitem").hidden = (frameData == null);

  let location = getCurrentLocation();
  E("abp-removeWhitelist-menuitem").hidden = (!location || !abp.policy.isWhitelisted(location.spec, "DOCUMENT"));
}

// Bring up the settings dialog for the node the context menu was referring to
function abpNode(data) {
  if (data)
    window.openDialog("chrome://adblockplus/content/ui/composer.xul", "_blank", "chrome,centerscreen,resizable,dialog=no,dependent", abpHooks.getBrowser().contentWindow, data);
}
