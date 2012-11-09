/*
 * This Source Code is subject to the terms of the Mozilla Public License
 * version 2.0 (the "License"). You can obtain a copy of the License at
 * http://mozilla.org/MPL/2.0/.
 */

let {Prefs} = require("prefs");

let TypoActions =
{
  init: function()
  {
    TypoActions.updateState();
    TypoActions.updateList();
    
    Prefs.addListener(TypoActions.onPrefChange);
    window.addEventListener("unload", function() Prefs.removeListener(TypoActions.onPrefChange), false);
  },
  
  onPrefChange: function(name)
  {
    if (name == "whitelist")
      TypoActions.updateList();
    else if (name == "correctTypos")
      TypoActions.updateState();
  },
  
  setEnabled: function(checked)
  {
    Prefs.correctTypos = checked;
  },
  
  onItemSelected: function(list)
  {
    let button = E(list.getAttribute("_removeButton"));
    let items = list.selectedItems;
    button.disabled = (items.length == 0 || (items.length == 1 && !items[0].value));
  },

  removeRule: function(btn, pref)
  {
    let list = E(btn.getAttribute("_list"));
    let items = list.selectedItems;
    
    let {onWhitelistEntryRemoved} = require("typoRules");
    
    for (let i = items.length - 1; i >= 0; i--)
    {
      let searchString = items[i].getAttribute("value");
      delete Prefs[pref][searchString];
      
      if (pref == "whitelist")
        onWhitelistEntryRemoved(searchString);
    }
    Prefs[pref] = JSON.parse(JSON.stringify(Prefs[pref]));
  },
  
  updateList: function()
  {
    let whitelistElement = E("typo_whitelist");

    // Remove existing list entries
    for (let i = whitelistElement.getRowCount() - 1; i >= 0; i--)
      whitelistElement.removeItemAt(i);

    // Build a list of exceptions and sort it alphabetically
    let whitelist = Object.keys(Prefs.whitelist);
    whitelist.sort();

    // Add the rules to the list
    if (whitelist.length > 0)
    {
      for (let i = 0; i < whitelist.length; i++)
      {
        let option = document.createElement("listitem");
        option.setAttribute("value", whitelist[i]);
        option.setAttribute("label", whitelist[i]);

        whitelistElement.appendChild(option);
      }
    }
    else
    {
      let option = document.createElement("listitem");
      option.setAttribute("class", "auto-entry");
      option.setAttribute("label", whitelistElement.getAttribute("_emptyLabel"));

      whitelistElement.appendChild(option);
    }
  },
  
  updateState: function()
  {
    let enabled = Prefs.correctTypos;
    E("typo_enable").checked = enabled;
    E("typo_whitelist_container").hidden = !enabled;
  }
};

window.addEventListener("load", function()
{
  TypoActions.init();
}, false);
