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

var abp = Components.classes["@mozilla.org/adblockplus;1"].createInstance();
while (abp && !("getString" in abp))
  abp = abp.wrappedJSObject;    // Unwrap component
var prefs = abp.prefs;
var flasher = abp.flasher;
var synchronizer = abp.synchronizer;
var shouldSort = prefs.listsort;
var suggestionItems = [];
var insecWnd = null;   // Window we should apply filters at
var wndData = null;    // Data for this window
var initialized = false;
var whitelistDescr = abp.getString("whitelist_description");
var filterlistDescr = abp.getString("filterlist_description");
var origGrouporder = null;
var origSynch = null;
var saved = false;
var lineBreak = null;   // Plattform dependent line break

// Preference window initialization
function init() {
  initialized = true;
  var filterSuggestions = document.getElementById("newfilter");
  var data = [];

  document.getElementById("disabledWarning").setAttribute("hide", prefs.enabled);

  // Install listeners
  prefs.addListener(onPrefChange);
  synchronizer.addListener(synchCallback);

  // Save subscriptions to restore them if we are cancelled
  origGrouporder = [];
  origSynch = new abp.HashTable();
  prefs.cloneSubscriptions(origGrouporder, origSynch);

  if ('arguments' in window && window.arguments.length >= 1)
    insecWnd = window.arguments[0];
  else {
    var windowMediator = Components.classes["@mozilla.org/appshell/window-mediator;1"].getService(Components.interfaces.nsIWindowMediator);
    var browser = windowMediator.getMostRecentWindow("navigator:browser");
    if (browser)
      insecWnd = browser.getBrowser().contentWindow;
  }

  if (insecWnd) {
    // Retrieve data for the window
    wndData = abp.getDataForWindow(insecWnd);
    data = wndData.getAllLocations();

    // Activate flasher
    filterSuggestions.inputField.addEventListener("input", onInputChange, false);

    // List selection doesn't fire input event, have to register a property watcher
    filterSuggestions.inputField.watch("value", onInputChange);
  }
  if (!data.length) {
    var reason = abp.getString("no_blocking_suggestions");
    var isWhite = false;
    if (insecWnd) {
      var insecLocation = secureGet(insecWnd, "location");
      // We want to stick with "no blockable items" for about:blank
      if (secureGet(insecLocation, "href") != "about:blank") {
        if (!abp.policy.isBlockableScheme(insecLocation))
          reason = abp.getString("not_remote_page");
        else if (abp.policy.isWhitelisted(secureGet(insecLocation, "href"))) {
          reason = abp.getString("whitelisted_page");
          isWhite = true;
        }
      }
    }
    data.push({location: reason, typeDescr: "", localizedDescr: "", inseclNodes: [], filter: {isWhite: isWhite}});
  }

  // Initialize filter suggestions dropdown
  for (var i = 0; i < data.length; i++)
    createFilterSuggestion(filterSuggestions, data[i]);

  if ('arguments' in window && typeof window.arguments[1] != "undefined")
    filterSuggestions.label = filterSuggestions.value = window.arguments[1];

  // Fill the filter list
  fillList();

  // Set the focus to the list if a filter was selected, otherwise to the input field
  if ('arguments' in window && typeof window.arguments[2] != "undefined" && window.arguments[2])
    document.getElementById("list").focus();
  else
    filterSuggestions.focus();
}

// To be called when the window is closed
function cleanUp() {
  prefs.removeListener(onPrefChange);
  synchronizer.removeListener(synchCallback);
  flasher.stop();

  if (!saved && origSynch)
    prefs.restoreSubscriptions(origGrouporder, origSynch);
}

function createDescription(label, flex) {
  var result = document.createElement("description");
  result.setAttribute("value", label);
  if (flex) {
    result.flex = flex;
    result.setAttribute("crop", "center");
  }
  return result;
}

function createFilterSuggestion(menulist, suggestion) {
  var menuitem = menulist.appendItem(suggestion.location, suggestion.location);

  menuitem.appendChild(createDescription(suggestion.localizedDescr, 0));
  menuitem.appendChild(createDescription(suggestion.location, 1));

  if (suggestion.filter && suggestion.filter.isWhite)
    menuitem.className = "whitelisted";
  else if (suggestion.filter)
    menuitem.className = "filtered";

  suggestionItems.push(menuitem);
}

function fixColWidth() {
  var maxWidth = 0;
  for (var i = 0; i < suggestionItems.length; i++) {
    if (suggestionItems[i].childNodes[0].boxObject.width > maxWidth)
      maxWidth = suggestionItems[i].childNodes[0].boxObject.width;
  }
  for (i = 0; i < suggestionItems.length; i++) {
    // Older versions don't support .style in XUL - have to use style attribute
    suggestionItems[i].childNodes[0].setAttribute("style", "width: "+maxWidth+"px");
  }
}

function onInputChange(prop, oldval, newval) {
  var value = (typeof newval == "string" ? newval : document.getElementById("newfilter").inputField.value);
  var loc = wndData.getLocation(value);
  flasher.flash(loc ? loc.inseclNodes : null);
  return newval;
};

function fillList() {
  // Initialize editor
  editor.bind(document.getElementById("list"));

  // Initialize group manager
  var list = document.getElementById("list");
  groupManager.bind(list);

  // Split up patterns list into whitelist and filterlist
  var whitelist = [];
  var filterlist = [];
  for (var i = 0; i < prefs.patterns.length; i++)
    (prefs.patterns[i].indexOf("@@") == 0 ? whitelist : filterlist).push(prefs.patterns[i]);

  // Add groups
  if (whitelist.length)
    addToGroup("~wl~", whitelist);
  if (filterlist.length)
    addToGroup("~fl~", filterlist);

  // Add filter subscriptions
  for (i = 0; i < prefs.grouporder.length; i++) {
    if (prefs.grouporder[i].indexOf("~") == 0 || groupManager.hasGroupName(prefs.grouporder[i]))
      continue;

    var synchPrefs = prefs.synch.get(prefs.grouporder[i]);
    if (typeof synchPrefs == "undefined")
      continue;

    addSubscriptionGroup(prefs.grouporder[i], synchPrefs, true);
  }

  // Select a row
  if ('arguments' in window && typeof window.arguments[2] != "undefined" && window.arguments[2])
    groupManager.selectPattern(window.arguments[2].origPattern);

  groupManager.ensureSelection();
}

// Returns an array containing description for a subscription group
function getSubscriptionDescription(synchPrefs) {
  var descr = [abp.getString("subscription_description") + ": " + synchPrefs.title];
  if (!synchPrefs.external)
    descr.push(abp.getString("subscription_source") + ": " + synchPrefs.url);

  var status = (synchPrefs.disabled ? abp.getString("subscription_status_disabled") : abp.getString("subscription_status_enabled"));
  if (!synchPrefs.external) {
    status += "; " + (synchPrefs.autodownload ? abp.getString("subscription_status_autodownload") : abp.getString("subscription_status_manualdownload"));
    status += "; " + abp.getString("subscription_status_lastdownload") + ": ";
    if (synchronizer.isExecuting(synchPrefs.url))
      status += abp.getString("subscription_status_lastdownload_inprogress");
    else {
      status += (synchPrefs.lastdownload > 0 ? new Date(synchPrefs.lastdownload * 1000).toLocaleString() : abp.getString("subscription_status_lastdownload_unknown"));
      if (synchPrefs.lastdownload > 0 && synchPrefs.downloadstatus) {
        try {
          status += " (" + abp.getString(synchPrefs.downloadstatus) + ")";
        } catch (e) {}
      }
    }
  }
  else
    status += "; " + abp.getString("subscription_status_externaldownload");
  descr.push(abp.getString("subscription_status") + ": " + status);
  return descr;
}

// Adds a new group for the subscription to the list
function addSubscriptionGroup(groupName, synchPrefs, noChange) {
  var descr = getSubscriptionDescription(synchPrefs);
  groupManager.addGroup(groupName, descr, synchPrefs.patterns.slice(), "subscription");

  if (typeof noChange == "undefined" || !noChange)
    onChange();
}

// Updates description for a subscription group in the list
function updateSubscriptionDescription(group, synchPrefs, noChange) {
  if (typeof group == "string")
    group = groupManager.getGroupByName(group);
  if (!group)
    return;

  var descr = getSubscriptionDescription(synchPrefs);
  groupManager.setGroupDescription(group, descr);

  if (typeof noChange == "undefined" || !noChange)
    onChange();
}

// Adds the filter entered into the input field to the list
function addFilter() {
  var filterSuggestions = document.getElementById("newfilter");
  if (!filterSuggestions.value)
    return false;

  var filter = filterSuggestions.value.replace(/\s/g, "");
  if (!filter)
    return false;

  // Issue a warning if we got a regular expression
  if (!/^(@@)?\/.*\/$/.test(filter) || regexpWarning()) {
    filterSuggestions.label = filterSuggestions.value = "";
    addFilterInternal(filter);
  }
  return true;
}

// Adds a given filter or a filters list to a group
function addToGroup(group, filters) {
  if (typeof filters == "string")
    filters = [filters];

  // Check whether we got a group name instead of a group
  if (typeof group == "string") {
    if (!groupManager.hasGroupName(group)) {
      // Group doesn't exist yet, create it
      if (group == "~fl~")
        return groupManager.addGroup(group, [filterlistDescr], filters, "filterlist");
      else if (group == "~wl~")
        return groupManager.addGroup(group, [whitelistDescr], filters, "whitelist");
      else
        return null;
    }
    group = groupManager.getGroupByName(group);
  }

  for (var i = 0; i < filters.length; i++)
    groupManager.addPattern(group, filters[i], false);

  return group;
}

// Adds a given filter
function addFilterInternal(filter, origGroup, origPos) {
  var groupName = (filter.indexOf("@@") == 0 ? "~wl~" : "~fl~");
  if (!groupManager.hasGroupName(groupName)) {
    if (groupName == "~fl~")
      groupManager.addGroup(groupName, [filterlistDescr], [], "filterlist");
    else
      groupManager.addGroup(groupName, [whitelistDescr], [], "whitelist");
  }
  var group = groupManager.getGroupByName(groupName);
  if (origGroup != "undefined" && group == origGroup)
    groupManager.addPattern(group, filter, true, origPos);
  else
    groupManager.addPattern(group, filter, true);
}

// Asks the user if he really wants to clear the list.
function clearList() {
  if (confirm(abp.getString("clearall_warning"))) {
    groupManager.removeGroup("~wl~");
    groupManager.removeGroup("~fl~");
    onChange();
  }
}

// Imports filters from disc.
function importList() {
  if (!initialized)
    return;

  var picker = Components.classes["@mozilla.org/filepicker;1"]
                     .createInstance(Components.interfaces.nsIFilePicker);
  picker.init(window, abp.getString("import_filters_title"), picker.modeOpen);
  picker.appendFilters(picker.filterText);
  picker.appendFilters(picker.filterAll);
  if (picker.show() != picker.returnCancel) {
    var stream = Components.classes["@mozilla.org/network/file-input-stream;1"]
                           .createInstance(Components.interfaces.nsIFileInputStream);
    stream.init(picker.file, 0x01, 0444, 0);
    stream = stream.QueryInterface(Components.interfaces.nsILineInputStream);

    var lines = [];
    var line = {value: null};
    while (stream.readLine(line))
      lines.push(line.value.replace(/\s/g, ""));
    if (line.value)
      lines.push(line.value.replace(/\s/g, ""));
    stream.close();

    if (/\[Adblock\]/i.test(lines[0])) {
      var promptService = Components.classes["@mozilla.org/embedcomp/prompt-service;1"]
                                    .getService(Components.interfaces.nsIPromptService);
      var flags = promptService.BUTTON_TITLE_IS_STRING * promptService.BUTTON_POS_0 +
                  promptService.BUTTON_TITLE_CANCEL * promptService.BUTTON_POS_1 +
                  promptService.BUTTON_TITLE_IS_STRING * promptService.BUTTON_POS_2;
      var result = promptService.confirmEx(window, abp.getString("import_filters_title"),
        abp.getString("import_filters_warning"), flags, abp.getString("overwrite"),
        null, abp.getString("append"), null, {});
      if (result == 1)
        return;

      if (result == 0) {
        groupManager.removeGroup("~wl~");
        groupManager.removeGroup("~fl~");
      }

      var group1 = "~wl~";
      var group2 = "~fl~";
      for (var i = 1; i < lines.length; i++) {
        if (!lines[i])
          continue;

        if (lines[i].indexOf("@@") == 0)
          group1 = addToGroup(group1, lines[i]);
        else
          group2 = addToGroup(group2, lines[i]);
      }

      groupManager.ensureSelection();
      onChange();
    }
    else 
      alert(abp.getString("invalid_filters_file"));
  }
}

// Exports the current list of filters to a file on disc.
function exportList() {
  if (!initialized || document.getElementById("list").getRowCount() == 0)
    return;

  var picker = Components.classes["@mozilla.org/filepicker;1"].createInstance(Components.interfaces.nsIFilePicker);
  picker.init(window, abp.getString("export_filters_title"), picker.modeSave);
  picker.defaultExtension=".txt";
  picker.appendFilters(picker.filterText);
  picker.appendFilters(picker.filterAll);

  if (picker.show() != picker.returnCancel) {
    if (lineBreak == null) {
      // HACKHACK: Gecko doesn't expose NS_LINEBREAK, try to determine
      // plattform's line breaks by reading prefs.js
      lineBreak = "\n";
      try {
        var dirService = Components.classes["@mozilla.org/file/directory_service;1"]
                                   .createInstance(Components.interfaces.nsIProperties);
        var prefFile = dirService.get("PrefF", Components.interfaces.nsIFile);
        var inputStream = Components.classes["@mozilla.org/network/file-input-stream;1"]
                                    .createInstance(Components.interfaces.nsIFileInputStream);
        inputStream.init(prefFile, 0x01, 0444, 0);

        var scriptableStream = Components.classes["@mozilla.org/scriptableinputstream;1"]
                                         .createInstance(Components.interfaces.nsIScriptableInputStream);
        scriptableStream.init(inputStream);
        var data = scriptableStream.read(1024);
        scriptableStream.close();

        if (/(\r\n?|\n\r?)/.test(data))
          lineBreak = RegExp.$1;
      } catch (e) {alert(e)}
    }

    try {
      var stream = Components.classes["@mozilla.org/network/file-output-stream;1"]
                            .createInstance(Components.interfaces.nsIFileOutputStream);
      stream.init(picker.file, 0x02 | 0x08 | 0x20, 0644, 0);
  
      var patterns = getPatterns();
      patterns.unshift("[Adblock]");
      var output = patterns.join(lineBreak) + lineBreak;
      stream.write(output, output.length);
  
      stream.close();
    }
    catch (e) {
      dump("Adblock Plus: error writing to file: " + e + "\n");
      alert(abp.getString("filters_write_error"));
    }
  }
}

// Handles keypress event on the new filter input field
function onFilterKeyPress(e) {
  if ((e.keyCode == e.DOM_VK_RETURN || e.keyCode == e.DOM_VK_ENTER) && addFilter())
    e.preventDefault();
}

// Handles keypress event on the patterns list
function onListKeyPress(e) {
  // Ignore any keys directed to the editor
  if (editor.isEditing())
    return;

  if (e.keyCode == e.DOM_VK_BACK_SPACE || e.keyCode == e.DOM_VK_DELETE) {
    var group = groupManager.getSelectedGroup();
    if (group && group.name.indexOf("~") != 0)
      removeSubscription(group);
    else
      removeFilter();
  }
  else if ((e.keyCode == e.DOM_VK_UP || e.keyCode == e.DOM_VK_DOWN) && e.ctrlKey && !e.altKey && !e.metaKey) {
    if (e.shiftKey)
      moveGroup(e.keyCode == e.DOM_VK_UP);
    else
      moveFilter(e.keyCode == e.DOM_VK_UP);
    e.preventDefault();
    try{e.cancelBubble()} catch(error) {};  // For some strange reason this works, preventDefault() does nothing
  }
}

// To be called whenever synchronization status changes
function synchCallback(synchPrefs, status) {
  var group = groupManager.getGroupByName(synchPrefs.url);
  if (!group)
    return;

  if (status == "ok") {
    var select = (groupManager.getSelectedGroup() == group);

    groupManager.removeGroup(group.name);
    addSubscriptionGroup(group.name, synchPrefs, true);

    if (select)
      groupManager.selectGroup(group.name);
  }
  else
    updateSubscriptionDescription(group, synchPrefs, true);
}

// Edits a subscription or adds a new one
function editSubscription(group) {
  var name = (group ? group.name : null);
  openDialog("chrome://adblockplus/content/subscription.xul", "_blank", "chrome,centerscreen,modal", abp, prefs, name);
}

// Removes the selected entries from the list and sets selection to the next item
function removeFilter() {
  // Create a list of removable items
  var list = document.getElementById("list");
  var selected = list.selectedItems;
  var items = [];
  for (var i = 0; i < selected.length; i++)
    if ("abpFilter" in selected[i] && selected[i].className != "subscription")
      items.push(selected[i]);
  if (items.length == 0)
    return;

  // Choose another list item to select when the current are removed
  var newSelection = list.getNextItem(selected[selected.length - 1], 1);
  if (!newSelection)
    newSelection = list.getPreviousItem(selected[0], 1);

  // Remove items and adjust selection
  for (i = 0; i < items.length; i++)
    groupManager.removePattern(items[i].abpGroup, items[i].abpFilter);
  if (newSelection && newSelection.parentNode) {
    list.ensureElementIsVisible(newSelection);
    list.selectedItem = newSelection;
  }
}

// Starts synchronization for a subscription
function synchSubscription(group) {
  if (!group || group.name.indexOf("~") == 0 || !prefs.synch.has(group.name))
    return;

  var synchPrefs = prefs.synch.get(group.name);
  synchronizer.execute(synchPrefs);
}

// Removes a subscription
function removeSubscription(group) {
  if (!group || !confirm(abp.getString("remove_subscription_warning")))
    return;

  prefs.removeSubscription(group.name);

  groupManager.removeGroup(group);
  groupManager.ensureSelection();

  onChange();
}

// Moves a group up and down in the list
function moveGroup(up) {
  var list = document.getElementById("list");
  var item = list.currentItem;
  if (!item || !("abpGroup" in item))
    return;

  var group = item.abpGroup;
  var groupIndex = -1;
  var prevIndex = -1;
  var nextIndex = -1;
  for (var i = 0; i < prefs.grouporder.length; i++) {
    if (!groupManager.hasGroupName(prefs.grouporder[i]))
      continue;

    if (prefs.grouporder[i] == group.name)
      groupIndex = i;
    else if (groupIndex < 0)
      prevIndex = i;
    else if (nextIndex < 0)
      nextIndex = i;
  }

  var switchWith = (up ? prevIndex : nextIndex);
  if (groupIndex < 0 || switchWith < 0)
    return;

  var tmp = prefs.grouporder[groupIndex];
  prefs.grouporder[groupIndex] = prefs.grouporder[switchWith];
  prefs.grouporder[switchWith] = tmp;
  prefs.save();

  groupManager.readdGroup(group);
  groupManager.selectGroup(group.name);

  onChange();
}

// Moves a filter up and down in the list
function moveFilter(up) {
  if (prefs.listsort)
    return;

  var list = document.getElementById("list");
  var item = list.currentItem;
  if (!item || !("abpFilter" in item) || item.className == "subscription")
    return;

  var switchWith = (up ? list.getPreviousItem(item, 1) : list.getNextItem(item, 1));
  if (!switchWith || !("abpFilter" in switchWith) || item.abpGroup != item.abpGroup)
    return;

  // Switching stored position
  var tmp = item.abpFilter.origPos;
  item.abpFilter.origPos = switchWith.abpFilter.origPos;
  switchWith.abpFilter.origPos = tmp;

  // Moving in the list
  if (up)
    switchWith.parentNode.insertBefore(item, switchWith);
  else
    item.parentNode.insertBefore(switchWith, item);

  // Restoring selection
  list.ensureElementIsVisible(item);
  list.selectedItem = item;

  onChange();
}

// Makes sure the right items in the options popup are checked/enabled
function fillFiltersPopup(prefix) {
  var empty = !groupManager.hasGroupName("~wl~") && !groupManager.hasGroupName("~fl~");
  document.getElementById("export-command").setAttribute("disabled", empty);
  document.getElementById("clearall").setAttribute("disabled", empty);

  document.getElementById("listsort").setAttribute("checked", prefs.listsort);
}

// Makes sure the right items in the options popup are checked
function fillOptionsPopup() {
  document.getElementById("enabled").setAttribute("checked", prefs.enabled);
  document.getElementById("showinstatusbar").setAttribute("checked", prefs.showinstatusbar);
  document.getElementById("localpages").setAttribute("checked", prefs.blocklocalpages);
  document.getElementById("frameobjects").setAttribute("checked", prefs.frameobjects);
  document.getElementById("slowcollapse").setAttribute("checked", !prefs.fastcollapse);
  document.getElementById("linkcheck").setAttribute("checked", prefs.linkcheck);
}

// Makes sure the right items in the context menu are checked/enabled
function fillContext() {
  var list = document.getElementById("list");

  var group = groupManager.getSelectedGroup();
  document.getElementById("context-synchsubscription").hidden = !group;
  document.getElementById("context-edit").hidden = group;
  document.getElementById("context-editsubscription").hidden = !group;
  document.getElementById("context-remove").hidden = group;
  document.getElementById("context-removesubscription").hidden = !group;
  document.getElementById("context-moveup").hidden = group;
  document.getElementById("context-movegroupup").hidden = !group;
  document.getElementById("context-movedown").hidden = group;
  document.getElementById("context-movegroupdown").hidden = !group;

  if (group) {
    var isSubscription = (group.name.indexOf("~") != 0);
    var firstGroup = null;
    var lastGroup = null;
    for (var i = 0; i < prefs.grouporder.length; i++) {
      var curGroup = groupManager.getGroupByName(prefs.grouporder[i]);
      if (curGroup && !firstGroup)
        firstGroup = curGroup;
      if (curGroup)
        lastGroup = curGroup;
    }

    document.getElementById("context-synchsubscription").setAttribute("disabled", !isSubscription || prefs.synch.get(group.name).external);
    document.getElementById("context-editsubscription").setAttribute("disabled", !isSubscription);
    document.getElementById("context-removesubscription").setAttribute("disabled", !isSubscription);
    document.getElementById("context-movegroupup").setAttribute("disabled", group == firstGroup);
    document.getElementById("context-movegroupdown").setAttribute("disabled", group == lastGroup);
  }
  else {
    var current = list.currentItem;
    var editable =  (current && "abpFilter" in current && current.className != "subscription");
  
    var prevEditable = false;
    var nextEditable = false;
    if (editable && !prefs.listsort) {
      var prev = list.getPreviousItem(current, 1);
      prevEditable = (prev && "abpFilter" in prev && prev.abpGroup == current.abpGroup);
      var next = list.getNextItem(current, 1);
      nextEditable = (next && "abpFilter" in next && next.abpGroup == current.abpGroup);
    }
  
    var removable = false;
    for (i = 0; !removable && i < list.selectedItems.length; i++)
      if ("abpFilter" in list.selectedItems[i] && list.selectedItems[i].className != "subscription")
        removable = true;
  
    document.getElementById("context-edit").setAttribute("disabled", !editable);
    document.getElementById("context-remove").setAttribute("disabled", !removable);
    document.getElementById("context-moveup").setAttribute("disabled", !prevEditable);
    document.getElementById("context-movedown").setAttribute("disabled", !nextEditable);
  }

  document.getElementById("context-listsort").setAttribute("checked", prefs.listsort);
}

// Toggles the value of a boolean pref
function togglePref(pref) {
  prefs[pref] = !prefs[pref];
  prefs.save();
}

function onPrefChange() {
  if (prefs.listsort != shouldSort)
    groupManager.resort();

  document.getElementById("disabledWarning").setAttribute("hide", prefs.enabled);

  shouldSort = prefs.listsort;
}

// Reads filter patterns from the list
function getPatterns() {
  var patterns = [];
  var groupNames = ["~wl~", "~fl~"];
  for (var i = 0; i < groupNames.length; i++) {
    var group = groupManager.getGroupByName(groupNames[i]);
    if (group) {
      group.filters.sort(compareUnsorted);
      for (var j = 0; j < group.filters.length; j++)
        patterns.push(group.filters[j].value);
    }
  }
  return patterns;
}

// Save the settings and close the window.
function saveSettings() {
  // Make sure we don't save anything before the window has been initialized
  if (!initialized)
    return;

  prefs.patterns = getPatterns();
  prefs.save();
  saved = true;

  if (insecWnd)
    refilterWindow(insecWnd);
}

// Reapplies filters to all nodes of the current window
function refilterWindow(insecWnd) {
  if (secureGet(insecWnd, "closed"))
    return;

  var data = abp.getDataForWindow(insecWnd).getAllLocations();
  var policy = abp.policy;
  for (var i = 0; i < data.length; i++)
    if (!data[i].filter || data[i].filter.isWhite)
      for (var j = 0; j < data[i].inseclNodes.length; j++)
        policy.processNode(data[i].inseclNodes[j], data[i].type, data[i].location, true);
}

// Warns the user that he has entered a regular expression. 
// Returns true if the user is ok with this, false if he wants to change the filter.
function regexpWarning() {
  if (!prefs.warnregexp)
    return true;

  var promptService = Components.classes["@mozilla.org/embedcomp/prompt-service;1"]
                                .getService(Components.interfaces.nsIPromptService);
  var check = {value: false};
  var result = promptService.confirmCheck(window, abp.getString("regexp_warning_title"),
    abp.getString("regexp_warning_text"),
    abp.getString("regexp_warning_checkbox"), check);

  if (check.value) {
    prefs.warnregexp = false;
    prefs.save();
  }
  return result;
}

// Opens About Adblock Plus dialog
function openAbout() {
  openDialog("chrome://adblockplus/content/about.xul", "_blank", "chrome,centerscreen,modal");
}

// Removes all non-alphanumerical characters from a pattern (for sorting)
function normalizePattern(pattern) {
  return pattern.replace(/[^0-9a-zA-Z]/g, "").toLowerCase();
}

// Compares patterns by textual contents (ignore special chars)
function compareSorted(a, b) {
  if (a.normalizedValue < b.normalizedValue)
    return -1;
  else if (a.normalizedValue > b.normalizedValue)
    return 1;
  else if (a.value < b.value)
    return -1;
  else if (a.value > b.value)
    return 1;
  else
    return 0;
}

// Compares patterns by original positions (unsorted view)
function compareUnsorted(a, b) {
  if (a.value == b.value)
    return 0;
  else
    return a.origPos - b.origPos;
}

// To be called whenever the filter list has been changed and needs saving
function onChange() {
  document.getElementById("ok-command").removeAttribute("disabled");
  document.getElementById("ok-button").removeAttribute("disabled");
}

// Filter group manager
var groupManager = {
  list: null,
  groups: null,

  bind: function(list) {
    this.groups = new abp.HashTable();
    this.list = list;
  },

  addGroup: function(name, descr, filters, filterClass) {
    var beforeLine = -1;
    var found = false;
    for (var i = 0; beforeLine == -1 && i < prefs.grouporder.length; i++) {
      if (prefs.grouporder[i] == name)
        found = true;
      else if (found && this.groups.has(prefs.grouporder[i]))
        beforeLine = this.list.getIndexOfItem(this.groups.get(prefs.grouporder[i]).firstItem);
    }

    if (!found) {
      prefs.grouporder.push(name);
      prefs.save();
    }

    for (i = 0; i < filters.length; i++)
      filters[i] = {origPos: i, value: filters[i], normalizedValue: normalizePattern(filters[i])};

    if (prefs.listsort)
      filters.sort(compareSorted);

    var group = {name: name, filterClass: filterClass, descr: descr, filters: filters, firstItem: null, nextPos: filters.length};
    this.groups.put(name, group);

    for (i = 0; i < descr.length; i++) {
      var value = descr[i];
      var item = (beforeLine < 0 ? this.list.appendItem(value, value) : this.list.insertItemAt(beforeLine++, value, value));
      editor.initItem(item);
      item.abpGroup = group;
      item.className = (i == 0 ? "groupTitle first" : "groupTitle");
      if (!group.firstItem)
        group.firstItem = item;
    }

    for (i = 0; i < filters.length; i++) {
      value = filters[i].value;
      item = (beforeLine < 0 ? this.list.appendItem(value, value) : this.list.insertItemAt(beforeLine++, value, value));
      editor.initItem(item);
      item.abpGroup = group;
      item.abpFilter = filters[i];
      item.className = filterClass;
      filters[i].listItem = item;
    }

    return group;
  },

  removeGroup: function(group) {
    if (typeof group == "string")
      group = this.getGroupByName(group);

    if (!group)
      return;

    this.groups.remove(group.name);

    // Remove group description
    var item = group.firstItem;
    for (var i = 0; i < group.descr.length; i++) {
      var remove = item;
      item = this.list.getNextItem(item, 1);
      this.list.removeChild(remove);
    }

    // Remove filters
    for (i = 0; i < group.filters.length; i++)
      this.list.removeChild(group.filters[i].listItem);
  },

  getGroupByName: function(name) {
    var group = this.groups.get(name);
    if (typeof group == "undefined")
      return null;
    else
      return group;
  },

  hasGroupName: function(name) {
    return this.groups.has(name);
  },

  selectPattern: function(pattern) {
    for (var i = 0; i < prefs.grouporder.length; i++) {
      var group = this.groups.get(prefs.grouporder[i]);
      if (typeof group == "undefined")
        continue;

      for (var j = 0; j < group.filters.length; j++) {
        if (group.filters[j].value == pattern) {
          this.list.ensureElementIsVisible(group.filters[j].listItem);
          this.list.selectedItem = group.filters[j].listItem;
        }
      }
    }
  },

  selectGroup: function(group) {
    if (typeof group == "string")
      group = this.getGroupByName(group);

    if (group && group.firstItem) {
      this.list.ensureElementIsVisible(group.firstItem);
      this.list.selectedItem = group.firstItem;
    }
  },

  // Make sure something is selected
  ensureSelection: function() {
    if (this.list.selectedItems.length == 0 && this.list.getRowCount() > 0) {
      this.list.ensureIndexIsVisible(0);
      this.list.selectedIndex = 0;
    }
  },

  getSelectedGroup: function() {
    var items = this.list.selectedItems;
    if (items.length == 0 && this.list.currentItem)
      items = [this.list.currentItem];

    var group = null;
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if ("abpFilter" in item || !("abpGroup" in item))
        return null;

      if (group && item.abpGroup != group)
        return null;

      group = item.abpGroup;
    }
    return group;
  },

  addPattern: function(group, pattern, select, origPos) {
    if (typeof origPos == "undefined")
      origPos = group.nextPos++;

    var filter = {origPos: origPos, value: pattern, normalizedValue: normalizePattern(pattern)};
    var compare = (prefs.listsort ? compareSorted : compareUnsorted);
    var insertBefore = null;
    var item = null;
    for (var i = 0; !item && i < group.filters.length; i++) {
      var cmp = compare(filter, group.filters[i]);
      if (cmp == 0)
        item = group.filters[i].listItem;
      else if (cmp < 0 && (insertBefore == null || compare(group.filters[i], insertBefore) < 0))
        insertBefore = group.filters[i];
    }

    if (!item) {
      if (insertBefore)
        insertBefore = insertBefore.listItem;
  
      if (!insertBefore) {
        var found = false;
        for (i = 0; !insertBefore && i < prefs.grouporder.length; i++) {
          if (prefs.grouporder[i] == group.name)
            found = true;
          else if (found && this.groups.has(prefs.grouporder[i]))
            insertBefore = this.groups.get(prefs.grouporder[i]).firstItem;
        }
      }
  
      group.filters.push(filter);
  
      var beforeLine = (insertBefore ? this.list.getIndexOfItem(insertBefore) : -1);
      item = (beforeLine < 0 ? this.list.appendItem(pattern, pattern) : this.list.insertItemAt(beforeLine, pattern, pattern));
      editor.initItem(item);
      item.abpGroup = group;
      item.abpFilter = filter;
      item.className = group.filterClass;
      filter.listItem = item;

      onChange();
    }

    if (select) {
      this.list.ensureElementIsVisible(item);
      this.list.selectedItem = item;
    }
  },

  removePattern: function(group, filter) {
    for (var i = 0; i < group.filters.length; i++)
      if (group.filters[i] == filter)
        group.filters.splice(i--, 1);

    if (filter.listItem.parentNode)
      this.list.removeChild(filter.listItem);

    if (group.filters.length == 0)
      this.removeGroup(group);

    onChange();
  },

  readdGroup: function(group) {
    var select = (this.getSelectedGroup() == group);

    group.filters.sort(compareUnsorted);
    var filters = [];
    for (var i = 0; i < group.filters.length; i++)
      filters.push(group.filters[i].value);

    this.removeGroup(group);
    group = this.addGroup(group.name, group.descr, filters, group.filterClass);

    if (select)
      this.selectGroup(group);
  },

  setGroupDescription: function(group, descr) {
    var select = (this.getSelectedGroup() == group);

    // Add new group description
    var firstItem = null;
    var beforeLine = this.list.getIndexOfItem(group.firstItem);
    for (var i = 0; i < descr.length; i++) {
      var value = descr[i];
      var item = this.list.insertItemAt(beforeLine++, value, value);
      editor.initItem(item);
      item.abpGroup = group;
      item.className = (i == 0 ? "groupTitle first" : "groupTitle");
      if (!firstItem)
        firstItem = item;
    }

    // Remove old group description
    item = group.firstItem;
    for (i = 0; i < group.descr.length; i++) {
      var remove = item;
      item = this.list.getNextItem(item, 1);
      this.list.removeChild(remove);
    }

    // Update group info
    group.firstItem = firstItem;
    group.descr = descr;

    if (select)
      this.selectGroup(group);
  },

  resort: function() {
    // Store selected filter
    var currentPattern = null;
    var currentGroup = null;
    if (this.list.currentItem && "abpFilter" in this.list.currentItem)
      currentPattern = this.list.currentItem.abpFilter.value;
    else if (this.list.currentItem && "abpGroup" in this.list.currentItem)
      currentGroup = this.list.currentItem.abpGroup.name;

    // Readd all groups
    for (var i = 0; i < prefs.grouporder.length; i++)
      if (this.groups.has(prefs.grouporder[i]))
        this.readdGroup(this.groups.get(prefs.grouporder[i]));

    // Restore selected filter
    if (currentPattern)
      this.selectPattern(currentPattern);
    else if (currentGroup)
      this.selectGroup(currentGroup);
  }
};

// Inline list editor manager
var editor = {
  list: null,
  field: null,
  fieldParent: null,
  fieldHeight: 0,
  fieldKeypressHandler: null,
  fieldBlurHandler: null,
  editedItem: null,

  bind: function(list) {
    this.list = list;
    this.fieldParent = list.getItemAtIndex(0);
    this.field = this.fieldParent.firstChild;
    this.fieldHeight = this.field.boxObject.height;
    list.removeItemAt(0);

    var me = this;
    this.list.addEventListener("dblclick", function(e) {
      me.startEditor();
    }, false);
    this.list.addEventListener("keypress", function(e) {
      if (e.keyCode == e.DOM_VK_RETURN || e.keyCode == e.DOM_VK_ENTER) {
        me.startEditor();
        e.preventDefault();
      }
    }, false);
    this.fieldKeypressHandler = function(e) {
      if (e.keyCode == e.DOM_VK_RETURN || e.keyCode == e.DOM_VK_ENTER) {
        me.stopEditor(true);
        e.preventDefault();
      }
      else if (e.keyCode == e.DOM_VK_CANCEL || e.keyCode == e.DOM_VK_ESCAPE) {
        me.stopEditor(false);
        e.preventDefault();
      }
    };
    this.fieldBlurHandler = function(e) {
      me.stopEditor(true, true);
    };

    // prevent cyclic references through closures
    list = null;
  },

  initItem: function(item) {
    item.minHeight = this.fieldHeight + "px";
  },

  isEditing: function() {
    return this.editedItem != null;
  },

  startEditor: function() {
    this.stopEditor(false);

    var group = groupManager.getSelectedGroup();
    if (group && group.name.indexOf("~") != 0) {
      editSubscription(group);
      return;
    }

    var item = this.list.currentItem;
    if (!item || !("abpFilter" in item) || item.className == "subscription")
      return;

    // Replace item by our editor item and initialize it
    var value = item.abpFilter.value;
    item.parentNode.replaceChild(this.fieldParent, item);
    this.editedItem = item;
    this.field.value = value;
    this.field.setSelectionRange(value.length, value.length);
    this.field.focus();

    // textbox gives focus to the embedded <INPUT>, need to attach handlers to it
    document.commandDispatcher.focusedElement.addEventListener("keypress", this.fieldKeypressHandler, false);
    document.commandDispatcher.focusedElement.addEventListener("blur", this.fieldBlurHandler, false);
  },

  stopEditor: function(save, blur) {
    if (!this.editedItem)
      return;

    // Prevent recursive calls
    var item = this.editedItem;
    var value = this.field.value.replace(/\s/g, "");
    this.editedItem = null;

    // Move focus back to the list
    if (typeof blur == "undefined" || !blur)
      this.list.focus();

    if (save && value != item.abpFilter.value) {
      // Remove the editor and readd the pattern
      this.fieldParent.parentNode.removeChild(this.fieldParent);
      groupManager.removePattern(item.abpGroup, item.abpFilter);
      addFilterInternal(value, item.abpGroup, item.abpFilter.origPos);
    }
    else {
      // Put the item back into the list
      this.fieldParent.parentNode.replaceChild(item, this.fieldParent);
      this.list.ensureElementIsVisible(item);
      this.list.selectedItem = item;
    }
  }
};
