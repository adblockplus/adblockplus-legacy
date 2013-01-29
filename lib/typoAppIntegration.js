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

let {hook} = require("hooks");
let {application, addonName} = require("info");

let functionHooks = new WeakMap();

exports.removeFromWindow = function(window)
{
  if (functionHooks.has(window))
  {
    let unhook = functionHooks.get(window);
    unhook();
    functionHooks.delete(window);
  }
};

switch (addonName)
{
  case "url-fixer":
  {
    // URL Fixer
    exports.isTypoCorrectionEnabled = function(window, prefix, domain, suffix) true;

    break;
  }
  case "adblockplus":
  {
    // Adblock Plus
    let {Prefs} = require("prefs");

    // Do not ask to opt-in if user found setting
    if (!Prefs.correctTyposAsked)
    {
      let onPrefChange = function(name)
      {
        if (name == "correctTypos")
        {
          Prefs.correctTyposAsked = true;
          Prefs.removeListener(onPrefChange);
        }
      }

      Prefs.addListener(onPrefChange);
    }

    exports.isTypoCorrectionEnabled = function(window, prefix, domain, suffix)
    {
      if (!Prefs.correctTyposAsked && !Prefs.correctTypos)
      {
        let {Utils} = require("utils");
        let message = Utils.getString("typo_optin_message").replace(/\?1\?/, domain);
        let yes = Utils.getString("typo_optin_yes");
        let no = Utils.getString("typo_optin_no");
        let buttons = [
          {
            label:      yes,
            accessKey:  "",
            callback:   function()
            {
              // Yes: Enable typo correction
              Prefs.correctTypos = true;
              exports.loadURI(window, prefix + domain + suffix);
              Prefs.correctTyposAsked = true;
            }
          },
          {
            label:      no,
            accessKey:  "",
            callback:   function()
            {
              // No: Do nothing
              Prefs.correctTyposAsked = true;
            }
          }
        ];
        // We need to have persistence being set to 1 due to redirect which happens afterwards
        exports.openInfobar(window, "adblockplus-infobar-correct-typos-ask", message, buttons, 1);
      }

      return Prefs.correctTypos;
    };

    break;
  }
}

switch (application)
{
  case "firefox":
  {
    // Firefox
    exports.isKnownWindow = function(window) window.document.documentElement.getAttribute("windowtype") == "navigator:browser";

    exports.getURLBar = function(window) "gURLBar" in window ? window.gURLBar : null;

    exports.getBrowser = function(window) "gBrowser" in window ? window.gBrowser : null;

    exports.applyToWindow = function(window, corrector)
    {
      let urlbar = exports.getURLBar(window);
      if (urlbar && urlbar.handleCommand && !functionHooks.has(window))
      {
        // Handle new URLs being entered
        let unhook = hook(urlbar, "handleCommand", function()
        {
          let correction = corrector(window, urlbar.value);
          if (correction)
            urlbar.value = correction;
        });
        functionHooks.set(window, unhook);
      }
    };

    exports.openInfobar = function(window, id, message, buttons, persistence)
    {
      let browser = exports.getBrowser(window);
      let infobar = browser.getNotificationBox();
      let notification = infobar.getNotificationWithValue(id);

      if (notification)
      {
        infobar.removeNotification(notification);
      }
      notification = infobar.appendNotification(
        message,
        id,
        "chrome://" + addonName + "/skin/icon16.png",
        infobar.PRIORITY_INFO_HIGH,
        buttons
      );
      notification.persistence = persistence;
    };

    exports.loadURI = function(window, uri)
    {
      exports.getBrowser(window).loadURI(uri);
    };

    break;
  }
  case "seamonkey":
  {
    let eventListeners = new WeakMap();

    // SeaMonkey
    exports.isKnownWindow = function(window) window.document.documentElement.getAttribute("windowtype") == "navigator:browser";

    exports.getURLBar = function(window) "gURLBar" in window ? window.gURLBar : null;

    exports.getBrowser = function(window) "gBrowser" in window ? window.gBrowser : null;

    exports.applyToWindow = function(window, corrector)
    {
      let urlbar = exports.getURLBar(window);
      let goButton = window.document.getElementById("go-button-container");

      if (urlbar && urlbar._fireEvent && !functionHooks.has(window))
      {
        let correctURL = function()
        {
          let correction = corrector(window, urlbar.value);
          if (correction)
            urlbar.value = correction;
        };

        let unhook = hook(urlbar, "_fireEvent", function(eventType)
        {
          if (eventType == "textentered")
          {
            correctURL();
          }
        });
        functionHooks.set(window, unhook);

        if (goButton)
        {
          goButton.addEventListener("command", correctURL, true);
          eventListeners.set(window, {
            "listener": correctURL,
            "element": goButton
          });
        }
      }
    };

    let basicRemove = exports.removeFromWindow;
    exports.removeFromWindow = function(window)
    {
      basicRemove(window);

      if (eventListeners.has(window))
      {
        let eventListener = eventListeners.get(window);
        eventListener.element.removeEventListener("command", eventListener.listener, true);
        eventListeners.delete(window);
      }
    };

    exports.openInfobar = function(window, id, message, buttons, persistence)
    {
      let browser = exports.getBrowser(window);
      let infobar = browser.getNotificationBox();
      let notification = infobar.getNotificationWithValue(id);

      if (notification)
      {
        infobar.removeNotification(notification);
      }

      notification = infobar.appendNotification(
        message,
        id,
        "chrome://" + addonName + "/skin/icon16.png",
        infobar.PRIORITY_INFO_HIGH,
        buttons
      );
      notification.persistence = persistence;
    };

    exports.loadURI = function(window, uri)
    {
      exports.getBrowser(window).loadURI(uri);
    };

    break;
  }
  case "fennec":
  {
    // XUL Fennec
    exports.isKnownWindow = function(window) window.document.documentElement.getAttribute("windowtype") == "navigator:browser";

    exports.getURLBar = function(window) null;

    exports.getBrowser = function(window) null;

    exports.applyToWindow = function(window, corrector)
    {
      if ("BrowserUI" in window && window.BrowserUI.goToURI && !functionHooks.has(window))
      {
        // Handle new URLs being entered
        let unhook = hook(window.BrowserUI, "goToURI", function(url)
        {
          url = url || this._edit.value;

          let correction = corrector(window, url);
          if (correction)
            url = correction;

          return [url];
        });
        functionHooks.set(window, unhook);
      }
    };

    exports.openInfobar = function(window, id, message, buttons, persistence)
    {
      if ("getNotificationBox" in window)
      {
        let infobar = window.getNotificationBox();
        let notification = infobar.getNotificationWithValue(id);

        if (notification)
        {
          infobar.removeNotification(notification);
        }

        notification = infobar.appendNotification(
          message,
          id,
          "chrome://" + addonName + "/skin/icon16.png",
          infobar.PRIORITY_INFO_HIGH,
          buttons
        );
        notification.persistence = persistence;
      }
    };

    exports.loadURI = function(window, uri)
    {
      if ("BrowserUI" in window && "goToURI" in window.BrowserUI)
      {
        window.BrowserUI.goToURI(uri);
      }
    };

    break;
  }
  case "fennec2":
  {
    // Native Fennec
    exports.isKnownWindow = function(window) window.document.documentElement.getAttribute("windowtype") == "navigator:browser";

    exports.getURLBar = function(window) null;

    exports.getBrowser = function(window) null;

    exports.applyToWindow = function(window, corrector)
    {
      if ("BrowserApp" in window && window.BrowserApp.observe && !functionHooks.has(window))
      {
        let innerUnhook = null;
        let cleanup = function()
        {
          if (innerUnhook)
            innerUnhook();

          innerUnhook = null;
        };

        let unhook = hook(window.BrowserApp, "observe", function(subject, topic, data)
        {
          // Huge hack: we replace addTab/loadURI when the observer is
          // triggered. This seems to be the only way to know that the calls
          // originate from user input.
          let method = null;
          if (topic == "Tab:Add")
            method = "addTab";
          else if (topic == "Tab:Load")
            method = "loadURI";

          if (method)
          {
            innerUnhook = hook(this, method, function()
            {
              let params = Array.prototype.slice.apply(arguments);
              let correction = corrector(window, params[0]);
              if (correction)
                params[0] = correction;
              return params;
            });
          }
        }, cleanup);
        functionHooks.set(window, unhook);
      }
    };

    exports.openInfobar = function(window, id, message, buttons, persistence)
    {
      if ("BrowserApp" in window && "selectedTab" in window.BrowserApp)
      {
        window.NativeWindow.doorhanger.show(message, id, buttons, window.BrowserApp.selectedTab.id,
          {
            persistence: persistence
          }
        );
      }
    };

    exports.loadURI = function(window, uri)
    {
      if ("BrowserApp" in window && "loadURI" in window.BrowserApp)
        window.BrowserApp.loadURI(uri);
    };

    break;
  }
  default:
  {
    exports.isKnownWindow = function(window) false;
    break;
  }
}
