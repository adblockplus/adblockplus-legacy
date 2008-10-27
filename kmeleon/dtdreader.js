var _dtdReader = {
  unicodeConverter: Components.classes["@mozilla.org/intl/scriptableunicodeconverter"]
                              .createInstance(Components.interfaces.nsIScriptableUnicodeConverter),
  data : {__proto__: null},
  init: function() {
    var currentLocale = null;
    if ("@mozilla.org/chrome/chrome-registry;1" in Components.classes) {
      try {
        var xulRegistry = Components.classes["@mozilla.org/chrome/chrome-registry;1"]
                                    .getService(Components.interfaces.nsIXULChromeRegistry);
        currentLocale = xulRegistry.getSelectedLocale("adblockplus");
      } catch(e) {}
    }

    if (currentLocale)
      this.unicodeConverter.charset = (currentLocale == "ru-RU" ? "windows-1251" : (currentLocale == "pl-PL" ? "windows-1250" : "iso-8859-1"));
    else
      this.unicodeConverter.charset = "{{CHARSET}}";

    var request = Components.classes["@mozilla.org/xmlextras/xmlhttprequest;1"]
                            .createInstance(Components.interfaces.nsIXMLHttpRequest);
    request.open("GET", "chrome://adblockplus/locale/overlay.dtd", false);
    request.overrideMimeType("text/plain");
    request.send(null);

    var me = this;
    request.responseText.replace(/<!ENTITY\s+([\w.]+)\s+"([^"]+?)">/ig, function(match, key, value) {me.data[key] = value});

    for (var key in this.data) {
      if (/(.*)\.label$/.test(key)) {
        var base = RegExp.$1;
        var value = this.data[key];
        if (base + ".accesskey" in this.data)
          value = value.replace(new RegExp(this.data[base + ".accesskey"], "i"), "&$&");
        this.data[base] = value;
      }
    }
  },

  getEntity: function(name, unicode) {
    if (typeof unicode == "undefined")
        unicode = false;

    var ellipsis = false;
    if (/\.{3}$/.test(name)) {
      ellipsis = true;
      name = name.replace(/\.{3}$/, "");
    }
    var ret = (name in this.data ? this.data[name] : name) + (ellipsis ? "..." : "");
    return (unicode ? ret : this.unicodeConverter.ConvertFromUnicode(ret));
  }
}

_dtdReader.init();