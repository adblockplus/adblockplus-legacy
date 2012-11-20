/*
 * This file is part of the Adblock Plus,
 * Copyright (C) 2006-2012 Eyeo GmbH
 *
 * Adblock Plus is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3 as
 * published by the Free Software Foundation.
 *
 * Adblock Plus is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Adblock Plus.  If not, see <http://www.gnu.org/licenses/>.
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
