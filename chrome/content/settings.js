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

var abp = Components.classes["@mozilla.org/adblockplus;1"].getService();
while (abp && !("getPrefs" in abp))
  abp = abp.wrappedJSObject;    // Unwrap component
var prefs = abp.getPrefs();
var flasher = abp.getFlasher();
var suggestionItems = [];
var insecWnd = null;   // Window we should apply filters at
var initialized = false;

// Preference window initialization
function init() {
  initialized = true;
  var filterSuggestions = document.getElementById("newfilter");
  var wndData = null;
  var data = [];

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
    var flashHandler = function(prop, oldval, newval) {
      var value = (typeof newval == "string" ? newval : filterSuggestions.inputField.value);
      var loc = wndData.getLocation(value);
      flasher.flash(loc ? loc.inseclNodes : null);
      return newval;
    };
    filterSuggestions.inputField.addEventListener("input", flashHandler, false);

    // List selection doesn't fire input event, have to register a property watcher
    filterSuggestions.inputField.watch("value", flashHandler);
  }
  if (!data.length) {
    var reason = abp.getString("no_blocking_suggestions");
    if (insecWnd) {
      var insecLocation = secureGet(insecWnd, "location");
      // We want to stick with "no blockable items" for about:blank
      if (secureGet(insecLocation, "href") != "about:blank") {
        if (!abp.isBlockableScheme(insecLocation))
          reason = abp.getString("not_remote_page");
        else if (abp.isWhitelisted(secureGet(insecLocation, "href")))
          reason = abp.getString("whitelisted_page");
      }
    }
    data.push({location: reason, typeDescr: "", localizedDescr: "", inseclNodes: [], filter: {isWhite: false}});
  }

  // Initialize filter suggestions dropdown
  for (var i = 0; i < data.length; i++)
    createFilterSuggestion(filterSuggestions, data[i]);

  if ('arguments' in window && typeof window.arguments[1] != "undefined")
    filterSuggestions.label = filterSuggestions.value = window.arguments[1];

  // Initialize pattern list editor
  editor.init(document.getElementById("list"));

  // Fill the list with existing patterns
  fillList(prefs.patterns);

  // Set the focus always to the input field
  filterSuggestions.focus();
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
    menuitem.className = "whitelist";
  else if (suggestion.filter)
    menuitem.setAttribute("disabled", "true");

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

function fillList(patterns) {
  var list = document.getElementById("list");
  var selectPattern = null;
  var selectItem = null;

  if ('arguments' in window && typeof window.arguments[2] != "undefined" && window.arguments[2])
    selectPattern = window.arguments[2].origPattern;
  
  if (prefs.listsort)
    patterns.sort();  

  // fill the list with patterns
  for (var i = 0 ; i < patterns.length; i++) {
    var item = list.appendItem(patterns[i], patterns[i]);
    editor.initItem(item);
    if (i == 0 || patterns[i] == selectPattern)
      selectItem = item;
  }

  if (selectItem) {
    list.ensureElementIsVisible(selectItem);
    list.selectedItem = selectItem;
  }
}

// Add a filter to the list
function addFilter() {
  var filterSuggestions = document.getElementById("newfilter");
  if (!filterSuggestions.value)
    return;

  var filter = filterSuggestions.value.replace(/\s/g, "");
  if (!filter)
    return;

  // Issue a warning if we got a regular expression
  if (filter.match(/^\/.*\/$/) && !regexpWarning())
    return;

  filterSuggestions.label = filterSuggestions.value = "";

  var list = document.getElementById("list");
  var newItem = list.appendItem(filter, filter);
  editor.initItem(newItem);
  list.ensureElementIsVisible(newItem);
  list.selectedItem = newItem;
}

// Asks the user if he really wants to clear the list.
function clearList() {
  if (confirm(abp.getString("clearall_warning"))) {
    var list = document.getElementById("list");
    while (list.firstChild)
      list.removeChild(list.firstChild);
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

    if (lines[0].match(/\[Adblock\]/i)) {
      lines.shift();
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
        var list = document.getElementById("list");
        while (list.firstChild)
          list.removeChild(list.firstChild);
      }
      fillList(lines);
    }
    else 
      alert(abp.getString("invalid_filters_file"));
  }
}

// Exports the current list of filters to a file on disc.
function exportList() {
  if (!initialized)
    return;

  var picker = Components.classes["@mozilla.org/filepicker;1"].createInstance(Components.interfaces.nsIFilePicker);
  picker.init(window, abp.getString("export_filters_title"), picker.modeSave);
  picker.defaultExtension=".txt";
  picker.appendFilters(picker.filterText);

  if (picker.show() != picker.returnCancel) {
    try {
      var stream = Components.classes["@mozilla.org/network/file-output-stream;1"]
                            .createInstance(Components.interfaces.nsIFileOutputStream);
      stream.init(picker.file, 0x02 | 0x08 | 0x20, 0644, 0);
  
      var patterns = getPatterns();
      patterns.unshift("[Adblock]");
      var output = patterns.join("\n") + "\n";
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
  if ((e.keyCode == e.DOM_VK_RETURN || e.keyCode == e.DOM_VK_ENTER) &&
      document.getElementById("newfilter").value) {
    addFilter();
    e.preventDefault();
  }
}

// Handles keypress event on the patterns list
function onListKeyPress(e) {
  // Ignore any keys directed to the editor
  if (editor.isEditing())
    return;

  if (e.keyCode == e.DOM_VK_BACK_SPACE || e.keyCode == e.DOM_VK_DELETE)
    removeFilter();
}

// Removes the selected entry from the list and sets selection to the next item
function removeFilter(listItem) {
  var list = document.getElementById("list");

  // Parameter might be not a listitem node, check its parents
  if (typeof listItem != "undefined") {
    while (listItem && (listItem.nodeType != listItem.ELEMENT_NODE || listItem.tagName != "listitem"))
      listItem = listItem.parentNode;
  }
  else
    listItem = null;

  // If we didn't receive a parameter, try the selected item
  if (!listItem)
    listItem = list.selectedItem;

  if (!listItem)
    return;

  // Choose another list item to select when the current is removed
  var newSelection = list.getNextItem(listItem, 1);
  if (!newSelection)
    newSelection = list.getPreviousItem(listItem, 1)

  // Remove item and adjust selection
  list.removeChild(listItem);
  if (newSelection)
    list.selectItem(newSelection);
}

// Makes sure the right items in the options popup are checked/enabled
function fillFiltersPopup(prefix) {
  if (typeof prefix == "undefined")
    prefix = "";

  var rowCount = document.getElementById("list").getRowCount();
  document.getElementById(prefix + "export").setAttribute("disabled", rowCount == 0);
  document.getElementById(prefix + "clearall").setAttribute("disabled", rowCount == 0);

  document.getElementById(prefix + "listsort").setAttribute("checked", prefs.listsort);
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
  var listItem = document.popupNode;
  while (listItem && (listItem.nodeType != listItem.ELEMENT_NODE || listItem.tagName != "listitem"))
    listItem = listItem.parentNode;

  document.getElementById("context-edit").setAttribute("disabled", !listItem);
  document.getElementById("context-remove").setAttribute("disabled", !listItem);

  fillFiltersPopup("context-");
}

// Toggles the value of a boolean pref
function togglePref(pref) {
  prefs[pref] = !prefs[pref];
  abp.savePrefs();

  if (pref == "listsort" && prefs.listsort) {
    var patterns = getPatterns();
    patterns.sort();
  
    var list = document.getElementById("list");
    while (list.firstChild)
      list.removeChild(list.firstChild);
  
    fillList(patterns);
  }
}

// Reads filter patterns from the list
function getPatterns()
{
  var patterns = [];
  var list = document.getElementById("list");
  if (list.getRowCount() > 0)
    for (var item = list.getItemAtIndex(0); item; item = list.getNextItem(item, 1))
      patterns.push(item.getAttribute("value"));
  return patterns;
}

// Save the settings and close the window.
function saveSettings() {
  // Make sure we don't save anything before the window has been initialized
  if (!initialized)
    return;

  prefs.patterns = getPatterns();
  abp.savePrefs();

  if (insecWnd)
    refilterWindow(insecWnd);
}

// Reapplies filters to all nodes of the current window
function refilterWindow(insecWnd) {
  if (secureGet(insecWnd, "closed"))
    return;

  var data = abp.getDataForWindow(insecWnd).getAllLocations();
  for (var i = 0; i < data.length; i++)
    if (!data[i].filter || data[i].filter.isWhite)
      for (var j = 0; j < data[i].inseclNodes.length; j++)
        abp.processNode(data[i].inseclNodes[j], data[i].type, data[i].location, true);
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
    abp.savePrefs();
  }
  return result;
}

// Opens About Adblock Plus dialog
function openAbout() {
  openDialog("chrome://adblockplus/content/about.xul", "_blank", "chrome,centerscreen,modal");
}

// Inline list editor manager
var editor = {
  listbox: null,
  field: null,
  fieldParent: null,
  fieldHeight: 0,
  fieldKeypressHandler: null,
  fieldBlurHandler: null,
  editedItem: null,

  init: function(listbox) {
    this.listbox = listbox;
    this.fieldParent = listbox.getItemAtIndex(0);
    this.field = this.fieldParent.firstChild;
    this.fieldHeight = this.field.boxObject.height;
    listbox.removeItemAt(0);

    var me = this;
    this.listbox.addEventListener("dblclick", function(e) {
      me.startEditor();
    }, false);
    this.listbox.addEventListener("keypress", function(e) {
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
      me.stopEditor(true);
    };
  },

  initItem: function(item) {
    item.minHeight = this.fieldHeight + "px";
    if (item.getAttribute("label").indexOf("@@") == 0)
      item.className = "whitelist";
    else
      item.className = "blacklist";
  },

  isEditing: function() {
    return this.editedItem != null;
  },

  startEditor: function(item) {
    this.stopEditor(false);

    // Parameter might be not a listitem node, check its parents
    if (typeof item != "undefined") {
      while (item && (item.nodeType != item.ELEMENT_NODE || item.tagName != "listitem"))
        item = item.parentNode;

      if (item)
        this.editedItem = item;
    }

    // If we didn't receive a parameter, try the selected item
    if (!this.editedItem)
      this.editedItem = this.listbox.selectedItem;

    if (!this.editedItem)
      return;

    // Replace item by our editor item and initialize it
    var value = this.editedItem.getAttribute("label");
    this.editedItem.parentNode.replaceChild(this.fieldParent, this.editedItem);
    this.field.value = value;
    this.field.setSelectionRange(value.length, value.length);
    this.field.focus();

    // textbox gives focus to the embedded <INPUT>, need to attach handlers to it
    document.commandDispatcher.focusedElement.addEventListener("keypress", this.fieldKeypressHandler, false);
    document.commandDispatcher.focusedElement.addEventListener("blur", this.fieldBlurHandler, false);
  },

  stopEditor: function(save) {
    if (!this.editedItem)
      return;

    // Prevent recursive calls
    var item = this.editedItem;
    this.editedItem = null;

    // Put the item back into the list
    var value = this.field.value;
    this.listbox.focus();
    this.fieldParent.parentNode.replaceChild(item, this.fieldParent);
    this.listbox.selectedItem = item;

    // Put the value back into the list item if necessary
    if (save) {
      item.setAttribute("label", value);
      item.setAttribute("value", value);
      if (value.indexOf("@@") == 0)
        item.className = "whitelist";
      else
        item.className = "blacklist";
    }
  }
};
