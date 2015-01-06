/*
 * This file is part of Adblock Plus <http://adblockplus.org/>,
 * Copyright (C) 2006-2014 Eyeo GmbH
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

(function(global)
{
  const Ci = Components.interfaces;
  const Cu = Components.utils;

  if (!global.ext)
    global.ext = {};

  /* Message passing */
  global.ext.onMessage = new global.ext._EventTarget();

  global.ext.backgroundPage = new global.ext._MessageProxy(
      window.QueryInterface(Ci.nsIInterfaceRequestor)
                              .getInterface(Ci.nsIDocShell)
                              .QueryInterface(Ci.nsIInterfaceRequestor)
                              .getInterface(Ci.nsIContentFrameMessageManager),
      global.ext.onMessage);
  window.addEventListener("unload", function()
  {
    global.ext.backgroundPage._disconnect();
  }, false);

  /* i18n */
  global.ext.i18n = (function()
  {
    var Services = Cu.import("resource://gre/modules/Services.jsm", null).Services;
    var pageName = location.pathname.replace(/.*\//, "").replace(/\..*?$/, "");

    // Randomize URI to work around bug 719376
    var stringBundle = Services.strings.createBundle("chrome://adblockplus/locale/" + pageName +
      ".properties?" + Math.random());

    function getI18nMessage(key)
    {
      return {
        "message": stringBundle.GetStringFromName(key)
      };
    }

    function getText(message, args)
    {
      var text = message.message;
      var placeholders = message.placeholders;

      if (!args || !placeholders)
        return text;

      for (var key in placeholders)
      {
        var content = placeholders[key].content;
        if (!content)
          continue;

        var index = parseInt(content.slice(1), 10);
        if (isNaN(index))
          continue;

        var replacement = args[index - 1];
        if (typeof replacement === "undefined")
          continue;

        text = text.split("$" + key + "$").join(replacement);
      }
      return text;
    }

    return {
      getMessage: function(key, args)
      {
        try{
          var message = getI18nMessage(key);
          return getText(message, args);
        }
        catch(e)
        {
          // Don't report errors for special strings, these are expected to be
          // missing.
          if (key[0] != "@")
            Cu.reportError(e);
          return "";
        }
      }
    };
  })();
})(this);
