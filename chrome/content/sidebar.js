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
  while (abp && !('getString' in abp))
    abp = abp.wrappedJSObject;    // Unwrap component

  var prefs = abp.prefs;
  var flasher = abp.flasher;
  var DataContainer = abp.DataContainer;
} catch (e) {}

// Main browser window
var mainWin = parent;

// The window handler currently in use
var wndData = null;

var suggestionItems = [];
var itemsDummy, remoteDummy, whitelistDummy, loadDummy;
var currentDummy = null;

function init() {
  var filterSuggestions = document.getElementById("suggestionsList");
  itemsDummy = document.getElementById("noItemsDummy");
  itemsDummy.parentNode.removeChild(itemsDummy);
  remoteDummy = document.getElementById("notRemoteDummy");
  remoteDummy.parentNode.removeChild(remoteDummy);
  whitelistDummy = document.getElementById("whitelistedDummy");
  whitelistDummy.parentNode.removeChild(whitelistDummy);
  loadDummy = document.getElementById("notLoadedDummy");
  loadDummy.parentNode.removeChild(loadDummy);

  if (/sidebarDetached\.xul$/.test(parent.location.href)) {
    mainWin = parent.opener;
    window.__defineGetter__("content", function() {return mainWin.getBrowser().contentWindow});
    mainWin.addEventListener("unload", mainUnload, false);
    document.getElementById("detachButton").hidden = true;
    document.getElementById("reattachButton").hidden = false;
    if ("abpForceDetach" in mainWin && mainWin.abpForceDetach)
      document.getElementById("reattachButton").setAttribute("disabled", "true");
  } else if (abp && prefs.detachsidebar) {
    // Oops, we should've been detached but we aren't
    detach();
  }
  else {
    // Just for EzSidebar's sake :-(
    mainWin = mainWin.getBrowser().ownerDocument.defaultView;
  }

  if (abp) {
    itemsDummy.location = abp.getString("no_blocking_suggestions");
    remoteDummy.location = abp.getString("not_remote_page");
    whitelistDummy.location = abp.getString("whitelisted_page");
  }

  var data = [];
  if (abp) {
    // Install location listener
    DataContainer.addListener(handleLocationsChange);

    // Retrieve data for the window
    wndData = DataContainer.getDataForWindow(window.content);
    data = wndData.getAllLocations();

    // Activate flasher
    filterSuggestions.addEventListener("select", onSelectionChange, false);

    // Update dummy whenever necessary
    setInterval(function() {
      if (suggestionItems.length == 0)
        insertDummy(filterSuggestions);
    }, 2000);

    // Install a handler for tab changes
    mainWin.getBrowser().addEventListener("select", handleTabChange, false);
  }

  if (data.length) {
    // Initialize filter suggestions dropdown
    for (var i = 0; i < data.length; i++)
      createFilterSuggestion(filterSuggestions, data[i]);
  }
  else
    insertDummy(filterSuggestions);
}

// To be called for a detached window when the main window has been closed
function mainUnload() {
  parent.close();
}

// Decides which dummy item to insert into the list
function insertDummy(list) {
  var newDummy = loadDummy;
  if (abp) {
    newDummy = itemsDummy;

    var insecLocation = secureGet(window.content, "location");
    // We want to stick with "no blockable items" for about:blank
    if (secureGet(insecLocation, "href") != "about:blank") {
      if (!abp.policy.isBlockableScheme(insecLocation))
        newDummy = remoteDummy;
      else {
        var filter = abp.policy.isWhitelisted(secureGet(insecLocation, "href"));
        if (filter) {
          newDummy = whitelistDummy;
          newDummy.filter = filter;
        }
      }
    }
  }

  if (newDummy == currentDummy)
    return;         // Dummy already in the list

  removeDummy();  // Make sure other dummied aren't there
  list.appendChild(newDummy);
  currentDummy = newDummy;
}

// Removes the dummy from the list
function removeDummy() {
  if (currentDummy && currentDummy.parentNode)
    currentDummy.parentNode.removeChild(currentDummy);

  currentDummy = null;
}

// To be called on unload
function cleanUp() {
  if (!abp)
    return;

  flasher.stop();
  DataContainer.removeListener(handleLocationsChange);

  mainWin.getBrowser().removeEventListener("select", handleTabChange, false);
  mainWin.removeEventListener("unload", mainUnload, false);
}

// Called whenever list selection changes - triggers flasher
function onSelectionChange() {
  if (!wndData)
    return;

  var item = document.getElementById("suggestionsList").selectedItem;
  if (item)
    item = item.firstChild.nextSibling;

  var loc = null;
  if (item)
    loc = wndData.getLocation(item.getAttribute("label"));
  flasher.flash(loc ? loc.inseclNodes : null);
}

function createListCell(label, crop) {
  var result = document.createElement("listcell");
  result.setAttribute("label", label);
  if (crop)
    result.setAttribute("crop", "center");
  return result;
}

function createFilterSuggestion(listbox, suggestion) {
  var listitem = document.createElement("listitem");

  listitem.appendChild(createListCell(suggestion.localizedDescr, false));
  listitem.appendChild(createListCell(suggestion.location, true));
  listitem.filter = suggestion.filter;
  listitem.location = suggestion.location;
  if (listitem.filter && listitem.filter.type == "whitelist")
    listitem.className = "whitelisted";
  else if (listitem.filter)
    listitem.className = "filtered";

  listbox.appendChild(listitem);

  suggestionItems.push(listitem);
}

function handleLocationsChange(insecWnd, type, data, loc) {
  // Check whether this applies to us
  if (insecWnd != window.content)
    return;

  // Maybe we got called twice
  if (type == "select" && data == wndData)
    return;

  // If adding something from a new data container - select it
  if (type == "add" && data != wndData)
    type = "select";

  var i;
  var filterSuggestions = document.getElementById("suggestionsList");
  if (type == "select" || type == "refresh" || type == "clear") {
    // We moved to a different document, clear list
    filterSuggestions.selectedItem = filterSuggestions.currentItem = null;
    for (i = 0; i < suggestionItems.length; i++)
      filterSuggestions.removeChild(suggestionItems[i]);

    suggestionItems = [];

    if (type == "clear")
      wndData = null;
    else {
      wndData = data;

      // Add new items
      var locations = wndData.getAllLocations();
      for (i = 0; i < locations.length; i++)
        handleLocationsChange(insecWnd, "add", wndData, locations[i]);
    }
  } else if (type == "add") {
    removeDummy();

    // Add a new suggestion
    createFilterSuggestion(filterSuggestions, loc);
  }
}

function handleTabChange() {
  // Accessing controllers.getControllerForCommand in a newly
  // created tab crashes Firefox 1.5, have to delay this (bug 323641).
  var initialized = false;
  try {
    var requestor = secureLookup(window.content, "QueryInterface")(Components.interfaces.nsIInterfaceRequestor);
    var webNav = secureLookup(requestor, "getInterface")(Components.interfaces.nsIWebNavigation);
    initialized = (webNav.currentURI != null);
  } catch(e) {}

  if (!initialized) {
    setTimeout(handleTabChange, 10);
    return;
  }

  // Use new data
  handleLocationsChange(window.content, "select", DataContainer.getDataForWindow(window.content));
}

// Shows tooltip with the full uncropped location
function fillInTooltip(event) {
  var node = document.tooltipNode;
  while (node && (node.nodeType != node.ELEMENT_NODE || node.tagName != "listitem"))
    node = node.parentNode;

  if (!node || !("location" in node))
    return false;

  var pattern = ("filter" in node && node.filter ? node.filter.text : null);

  var text = document.getElementById("tooltipText");
  while (text.firstChild)
    text.removeChild(text.firstChild);

  for (var i = 0; i < node.location.length; i += 80) {
    var description = document.createElement("description");
    description.setAttribute("value", node.location.substr(i, 80));
    text.appendChild(description);
  }

  document.getElementById("tooltipFilter").hidden = !pattern;
  document.getElementById("tooltipFilterText").setAttribute("value", pattern);
  return true;
}

// Handles middle-click on an item
function openInTab(e) {
  // Only middle-clicks are handled
  if (e.button != 1)
    return;

  // Look for a listitem element in the parents chain
  var node = e.target;
  while (node && !(node.nodeType == node.ELEMENT_NODE && node.tagName == "listitem"))
    node = node.parentNode;

  // Ignore click if user didn't click a list item or clicked one of our dummy items
  if (!node || /Dummy$/.test(node.id))
    return;

  if (!node.firstChild || !node.firstChild.nextSibling)
    return;

  var url = node.firstChild.nextSibling.getAttribute("label");
  mainWin.delayedOpenTab(url);
}

// Starts up the main Adblock window
function doAdblock() {
  if (!abp)
    return;

  var listitem = document.getElementById("suggestionsList").selectedItem;

  // No location for the dummy items
  var location = (listitem && !listitem.id ? listitem.location : undefined);
  var filter = (listitem && "filter" in listitem ? listitem.filter : undefined);

  abp.openSettingsDialog(window.content, location, filter);
}

// detaches the sidebar
function detach() {
  if (!abp)
    return;

  var mainWin = window.mainWin;
  // Calculate default position for the detached window
  var boxObject = document.documentElement.boxObject;
  var position = ",left="+boxObject.screenX+",top="+boxObject.screenY+",outerWidth="+boxObject.width+",outerHeight="+boxObject.height;

  // Close sidebar and open detached window
  var wnd = mainWin.abpDetachedSidebar;
  mainWin.abpDetachedSidebar = null;
  prefs.detachsidebar = false;

  if ("SidebarGetRelativePanel" in mainWin)
    mainWin.SidebarGetRelativePanel(-1);
  else
    mainWin.abpToggleSidebar();

  if (wnd && !wnd.closed) {
    wnd.focus();
    mainWin.abpDetachedSidebar = wnd;
  }
  else {
    mainWin.abpForceDetach = false;
    mainWin.abpDetachedSidebar = mainWin.open("sidebarDetached.xul", "_blank", "chrome,resizable,dependent"+position);
  }

  // Save setting
  prefs.detachsidebar = true;
  prefs.save();
}

// reattaches the sidebar
function reattach() {
  if (!abp)
    return;

  // Save setting
  prefs.detachsidebar = false;
  prefs.save();

  // Open sidebar in window
  mainWin.abpDetachedSidebar = null;
  mainWin.abpToggleSidebar();
  parent.close();
}
