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

#include <windows.h>
#include "adblockplus.h"

abpWrapper wrapper;
char labelValues[NUM_LABELS][100];

JSFunctionSpec component_methods[] = {
  {"getMostRecentWindow", FakeGetMostRecentWindow, 1, 0, 0},
  {NULL},
};

JSFunctionSpec browser_methods[] = {
  {"openDialog", JSOpenDialog, 3, 0, 0},
  {"addEventListener", FakeAddEventListener, 3, 0, 0},
  {"removeEventListener", FakeRemoveEventListener, 3, 0, 0},
  {"getBrowser", JSDummyFunction, 0, 0, 0},
  {"getElementById", JSDummyFunction, 0, 0, 0},
  {"setAttribute", JSDummyFunction, 0, 0, 0},
  {"removeAttribute", JSDummyFunction, 0, 0, 0},
  {"appendChild", JSDummyFunction, 0, 0, 0},
  {"hasAttribute", FakeHasAttribute, 0, 0, 0},
  {"getAttribute", FakeGetAttribute, 0, 0, 0},
  {"setTimeout", FakeSetTimeout, 0, 0, 0},
  {"setInterval", JSDummyFunction, 0, 0, 0},
  {"delayedOpenTab", FakeOpenTab, 1, 0, 0},
  {"showItem", FakeShowItem, 2, 0, 0},
  {NULL},
};
JSPropertySpec browser_properties[] = {
  {"contentWindow", 0, JSPROP_READONLY|JSPROP_PERMANENT, JSGetContentWindow, nsnull},
  {"content", 1, JSPROP_READONLY|JSPROP_PERMANENT, JSGetContentWindow, nsnull},
  {"wrapper", 2, JSPROP_READONLY|JSPROP_PERMANENT, JSGetWrapper, nsnull},
  {NULL},
};

kmeleonFunctions* abpWrapper::kFuncs = NULL;
WORD abpWrapper::cmdBase = 0;
void* abpWrapper::origWndProc = NULL;
HWND abpWrapper::hMostRecent = NULL;
nsCOMPtr<nsIDOMWindowInternal> abpWrapper::fakeBrowserWindow;
nsIDOMWindow* abpWrapper::currentWindow = nsnull;
nsCOMPtr<nsIWindowWatcher> abpWrapper::watcher;
nsCOMPtr<nsIIOService> abpWrapper::ioService;
nsCOMPtr<nsIPrincipal> abpWrapper::systemPrincipal;
abpWindowList abpWrapper::activeWindows;
abpListenerList abpWrapper::selectListeners;
abpToolbarDataList abpWrapper::toolbarList;
int abpWrapper::setNextWidth = 0;
int abpWrapper::setNextHeight = 0;
HHOOK abpWrapper::hook = NULL;

BOOL APIENTRY DllMain(HINSTANCE hinstDLL, DWORD fdwReason, LPVOID lpvReserved) {
  return TRUE;
}

/************************
 * JavaScript callbacks *
 ************************/

JS_STATIC_DLL_CALLBACK(void) Reporter(JSContext *cx, const char *message, JSErrorReport *rep) {
  nsresult rv;

  nsCOMPtr<nsIConsoleService> consoleService = do_GetService(NS_CONSOLESERVICE_CONTRACTID);
  nsCOMPtr<nsIScriptError> errorObject = do_CreateInstance(NS_SCRIPTERROR_CONTRACTID);
  if (consoleService == nsnull || errorObject == nsnull)
    return;

  nsString messageUni(NS_ConvertASCIItoUTF16(message+0));
  nsString fileUni(NS_ConvertASCIItoUTF16(rep->filename));
  PRUint32 column = rep->uctokenptr - rep->uclinebuf;

  rv = errorObject->Init(messageUni.get(),
                         fileUni.get(),
                         NS_REINTERPRET_CAST(const PRUnichar*, rep->uclinebuf),
                         rep->lineno, column, rep->flags, "XPConnect JavaScript");
  if (NS_FAILED(rv))
    return;

  rv = consoleService->LogMessage(errorObject);
  if (NS_FAILED(rv))
    return;
}

JSBool JS_DLL_CALLBACK JSFocusDialog(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval) {
  nsresult rv;
  *rval = JSVAL_VOID;

  nsCOMPtr<nsIXPConnect> xpc = do_GetService(nsIXPConnect::GetCID());
  if (xpc == nsnull)
    return JS_TRUE;

  nsCOMPtr<nsIXPConnectWrappedNative> wrapped;
  rv = xpc->GetWrappedNativeOfJSObject(cx, obj, getter_AddRefs(wrapped));
  if (NS_FAILED(rv))
    return JS_TRUE;

  nsCOMPtr<nsISupports> native;
  rv = wrapped->GetNative(getter_AddRefs(native));
  if (NS_FAILED(rv))
    return JS_TRUE;

  nsCOMPtr<nsIDOMWindow> wnd = do_QueryInterface(native);
  if (wnd == nsnull)
    return JS_TRUE;

  wrapper.Focus(wnd);
  return JS_TRUE;
}

JSBool JS_DLL_CALLBACK FakeGetMostRecentWindow(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval) {
  *rval = JSVAL_NULL;

  char* type;
  if (!JS_ConvertArguments(cx, argc, argv, "s", &type))
    return JS_FALSE;

  nsIDOMWindowInternal* wnd = nsnull;
  if (strcmp(type, "navigator:browser") == 0)
    wnd = wrapper.GetBrowserWindow();
  else if (strcmp(type, "abp:settings") == 0)
    wnd = wrapper.GetSettingsWindow();

  if (wnd != nsnull) {
    PRBool closed;
    nsresult rv = wnd->GetClosed(&closed);
    if (NS_SUCCEEDED(rv) && closed)
      wnd = nsnull;
  }

  if (wnd == nsnull)
    return JS_TRUE;

  JSObject* ret = wrapper.GetGlobalObject(wnd);
  if (ret == nsnull)
    ret = wrapper.UnwrapNative(wnd);
  if (ret == nsnull)
    return JS_TRUE;

  // Fix up focus function
  JS_DefineFunction(cx, ret, "focus", JSFocusDialog, 0, 0);

  *rval = OBJECT_TO_JSVAL(ret);
  return JS_TRUE;
}

JSBool JS_DLL_CALLBACK JSOpenDialog(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval) {
  *rval = JSVAL_NULL;

  char* url;
  char* target = nsnull;
  char* features = nsnull;
  if (!JS_ConvertArguments(cx, argc, argv, "s/ss", &url, &target, &features))
    return JS_FALSE;

  JSObject* ret = wrapper.OpenDialog(url, target, features);
  if (ret == nsnull)
    return JS_TRUE;

  *rval = OBJECT_TO_JSVAL(ret);
  return JS_TRUE;  
}

JSBool JS_DLL_CALLBACK FakeAddEventListener(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval) {
  *rval = JSVAL_VOID;
  if (argc != 3)
    return JS_TRUE;

  JSString* event = JS_ValueToString(cx, argv[0]);
  JSFunction* handler = JS_ValueToFunction(cx, argv[1]);
  if (event == nsnull || handler == nsnull || strcmp(JS_GetStringBytes(event), "select") != 0)
    return JS_TRUE;

  wrapper.AddSelectListener(cx, handler);
  return JS_TRUE;
}

JSBool JS_DLL_CALLBACK FakeRemoveEventListener(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval) {
  *rval = JSVAL_VOID;
  if (argc != 3)
    return JS_TRUE;

  JSString* event = JS_ValueToString(cx, argv[0]);
  JSFunction* handler = JS_ValueToFunction(cx, argv[1]);
  if (event == nsnull || handler == nsnull || strcmp(JS_GetStringBytes(event), "select") != 0)
    return JS_TRUE;

  wrapper.RemoveSelectListener(handler);
  return JS_TRUE;
}

JSBool JS_DLL_CALLBACK FakeHasAttribute(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval) {
  *rval = JSVAL_FALSE;
  if (argc != 1)
    return JS_TRUE;

  JSString* attr = JS_ValueToString(cx, argv[0]);
  if (attr == nsnull)
    return JS_TRUE;

  if (strcmp(JS_GetStringBytes(attr), "chromehidden") == 0)
    *rval = JSVAL_TRUE;

  return JS_TRUE;
}

JSBool JS_DLL_CALLBACK FakeGetAttribute(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval) {
  *rval = JSVAL_NULL;

  if (argc != 1)
    return JS_TRUE;

  JSString* attr = JS_ValueToString(cx, argv[0]);
  if (attr == nsnull)
    return JS_TRUE;

  if (strcmp(JS_GetStringBytes(attr), "chromehidden") == 0) {
    char value[] = "extrachrome";
    JSString* str = JS_NewStringCopyZ(cx, value);
    if (str != nsnull)
      *rval = STRING_TO_JSVAL(str);
  }

  return JS_TRUE;
}

JSBool JS_DLL_CALLBACK FakeSetTimeout(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval) {
  *rval = JSVAL_VOID;

  JSFunction* function;
  int32 timeout;
  if (!JS_ConvertArguments(cx, argc, argv, "fj", &function, &timeout))
    return JS_FALSE;

  jsval retval;
  return JS_CallFunction(cx, obj, function, 0, nsnull, &retval);
}

JSBool JS_DLL_CALLBACK FakeOpenTab(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval) {
  *rval = JSVAL_VOID;
  if (argc != 1)
    return JS_TRUE;

  JSString* url = JS_ValueToString(cx, argv[0]);
  if (url == nsnull)
    return JS_TRUE;

  wrapper.OpenTab(JS_GetStringBytes(url));
  return JS_TRUE;
}

JSBool JS_DLL_CALLBACK FakeShowItem(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval) {
  *rval = JSVAL_VOID;

  char* item;
  JSBool show;
  if (!JS_ConvertArguments(cx, argc, argv, "sb", &item, &show))
    return JS_FALSE;

  if (!show)
    return JS_TRUE;

  if (strcmp(item, "abp-image-menuitem") == 0)
    wrapper.AddContextMenuItem(CMD_IMAGE, labelValues[LABEL_CONTEXT_IMAGE]);
  else if (strcmp(item, "abp-object-menuitem") == 0)
    wrapper.AddContextMenuItem(CMD_OBJECT, labelValues[LABEL_CONTEXT_OBJECT]);
  else if (strcmp(item, "abp-link-menuitem") == 0)
    wrapper.AddContextMenuItem(CMD_LINK, labelValues[LABEL_CONTEXT_LINK]);
  else if (strcmp(item, "abp-frame-menuitem") == 0)
    wrapper.AddContextMenuItem(CMD_FRAME, labelValues[LABEL_CONTEXT_FRAME]);

  return JS_TRUE;
}

JSBool JS_DLL_CALLBACK JSDummyFunction(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval) {
  *rval = OBJECT_TO_JSVAL(obj);
  return JS_TRUE;
}

JSBool JS_DLL_CALLBACK JSGetContentWindow(JSContext *cx, JSObject *obj, jsval id, jsval *vp) {
  JSObject* wndObj = wrapper.GetGlobalObject(wrapper.GetCurrentWindow());
  if (wndObj != nsnull)
    *vp = OBJECT_TO_JSVAL(wndObj);
  else
    *vp = OBJECT_TO_JSVAL(obj);

  return JS_TRUE;
}

JSBool JS_DLL_CALLBACK JSGetWrapper(JSContext *cx, JSObject *obj, jsval id, jsval *vp) {
  nsresult rv;

  nsCOMPtr<nsIXPConnect> xpc = do_GetService(nsIXPConnect::GetCID());
  if (xpc == nsnull)
    return JS_FALSE;

  nsCOMPtr<nsIXPConnectJSObjectHolder> wrapperHolder;
  rv = xpc->WrapNative(cx, JS_GetParent(cx, obj), NS_STATIC_CAST(nsIClassInfo*, &wrapper), NS_GET_IID(nsIClassInfo), getter_AddRefs(wrapperHolder));
  if (NS_FAILED(rv))
    return JS_FALSE;

  JSObject* result;
  rv = wrapperHolder->GetJSObject(&result);
  if (NS_FAILED(rv))
    return JS_FALSE;

  *vp = OBJECT_TO_JSVAL(result);
  return JS_TRUE;
}

/**********************
 * K-Meleon callbacks *
 **********************/

LONG abpWrapper::DoMessage(LPCSTR to, LPCSTR from, LPCSTR subject, LONG data1, LONG data2)
{
  if (to[0] != '*' && _stricmp(to, kPlugin.dllname) != 0)
    return 0;

  LONG ret = 1;
  if (_stricmp(subject, "Load") == 0)
    ret = (Load() ? 1 : -1);
  else if (_stricmp(subject, "Setup") == 0)
    Setup();
  else if (_stricmp(subject, "Create") == 0)
    Create((HWND)data1);
  else if (_stricmp(subject, "Close") == 0)
    Close((HWND)data1);
  else if (_stricmp(subject, "Config") == 0)
    Config((HWND)data1);
  else if (_stricmp(subject, "Quit") == 0)
    Quit();
  else if (_stricmp(subject, "DoMenu") == 0) {
    LPSTR action = (LPSTR)data2;
    if (*action == 0)
      ret = 0;
    else {
      LPSTR string = strchr(action, ',');
      if (string) {
        *string = 0;
        string++;
      }
      else
        string = action;
  
      DoMenu((HMENU)data1, action, string);
    }
  }
  else if (_stricmp(subject, "DoAccel") == 0)
    *(PINT)data2 = DoAccel((LPSTR)data1);
  else if (_stricmp(subject, "DoRebar") == 0)
    DoRebar((HWND)data1);
  else
    ret = 0;

  return ret;
}

PRBool abpWrapper::Load() {
  nsresult rv;

  kFuncs = kPlugin.kFuncs;

  abpJSContextHolder contextHolder;
  JSContext* cx = contextHolder.get();
  if (cx == nsnull)
    return PR_FALSE;

  nsCOMPtr<nsIChromeRegistrySea> registry = do_GetService("@mozilla.org/chrome/chrome-registry;1", &rv);
  if (NS_FAILED(rv)) {
    JS_ReportError(cx, "Adblock Plus: Failed to chrome registry - wrong Gecko version?");
    return PR_FALSE;
  }

  rv = registry->InstallPackage("jar:resource:/chrome/adblockplus.jar!/content/", PR_FALSE);
  if (NS_FAILED(rv)) {
    JS_ReportError(cx, "Adblock Plus: Failed to register Adblock Plus chrome content");
    return PR_FALSE;
  }

  rv = registry->InstallLocale("jar:resource:/chrome/adblockplus.jar!/locale/" ABP_LANGUAGE "/", PR_FALSE);
  if (NS_FAILED(rv)) {
    JS_ReportError(cx, "Adblock Plus: Failed to register Adblock Plus locale");
    return PR_FALSE;
  }

  rv = registry->InstallSkin("jar:resource:/chrome/adblockplus.jar!/skin/classic/", PR_FALSE, PR_TRUE);
  if (NS_FAILED(rv)) {
    JS_ReportError(cx, "Adblock Plus: Failed to register Adblock Plus skin");
    return PR_FALSE;
  }

  rv = registry->SelectLocaleForPackage(NS_LITERAL_CSTRING(ABP_LANGUAGE), NS_LL("adblockplus"), PR_FALSE);
  if (NS_FAILED(rv)) {
    JS_ReportError(cx, "Adblock Plus: Failed to select Adblock Plus locale");
    return PR_FALSE;
  }

  rv = registry->SelectSkinForPackage(NS_LITERAL_CSTRING("classic/1.0"), NS_LL("adblockplus"), PR_FALSE);
  if (NS_FAILED(rv)) {
    JS_ReportError(cx, "Adblock Plus: Failed to select Adblock Plus skin");
    return PR_FALSE;
  }

  watcher = do_GetService(NS_WINDOWWATCHER_CONTRACTID);
  if (watcher == nsnull) {
    JS_ReportError(cx, "Adblock Plus: Failed to retrieve window watcher - wrong Gecko version?");
    return PR_FALSE;
  }

  rv = watcher->RegisterNotification(&wrapper);
  if (NS_FAILED(rv)) {
    JS_ReportError(cx, "Adblock Plus: Failed to register for window watcher notifications");
    return PR_FALSE;
  }

  ioService = do_GetService("@mozilla.org/network/io-service;1");
  if (ioService == nsnull) {
    JS_ReportError(cx, "Adblock Plus: Failed to retrieve IO service - wrong Gecko version?");
    return PR_FALSE;
  }

  if (!PatchComponent(cx))
    return PR_FALSE;

  cmdBase = kFuncs->GetCommandIDs(NUM_COMMANDS);

  return PR_TRUE;
}

void abpWrapper::Setup() {
  hook = SetWindowsHookEx(WH_CALLWNDPROCRET, &HookProc, NULL, GetCurrentThreadId());

  nsCOMPtr<nsIPrefBranch> branch(do_GetService(NS_PREFSERVICE_CONTRACTID));
  if (branch != nsnull) {
    ReadAccelerator(branch, "extensions.adblockplus.settings_key", "adblockplus(Preferences)");
    ReadAccelerator(branch, "extensions.adblockplus.sidebar_key", "adblockplus(ListAll)");
    ReadAccelerator(branch, "extensions.adblockplus.enable_key", "adblockplus(ToggleEnabled)");
  }

  wrapper.LoadImage(0);
}

void abpWrapper::Quit() {
  if (hook)
    UnhookWindowsHookEx(hook);
}

void abpWrapper::Create(HWND parent) {
  static PRBool initialized = PR_FALSE;
  if (!initialized) {
    initialized = PR_TRUE;

    abpJSContextHolder holder;
    JSObject* overlay = UnwrapNative(fakeBrowserWindow);
    jsval retval;
    if (holder.get() != nsnull)
      if (overlay == nsnull || !JS_CallFunctionName(holder.get(), overlay, "abpInit", 0, nsnull, &retval))
        JS_ReportError(holder.get(), "Adblock Plus: Failed to initialize overlay.js");
  }

  if (IsWindowUnicode(parent)) {
    origWndProc = (WNDPROC)GetWindowLongW(parent, GWL_WNDPROC);
    SetWindowLongW(parent, GWL_WNDPROC, (LONG)&WndProc);
  }
  else {
    origWndProc = (WNDPROC)GetWindowLongA(parent, GWL_WNDPROC);
    SetWindowLongA(parent, GWL_WNDPROC, (LONG)&WndProc);
  }

  hMostRecent = parent;
}

void abpWrapper::Close(HWND parent) {
  toolbarList.removeWindow(parent);
}

void abpWrapper::Config(HWND parent) {
  WndProc(parent, WM_COMMAND, cmdBase + CMD_PREFERENCES, 0);
}

void abpWrapper::DoMenu(HMENU menu, LPSTR action, LPSTR string) {
  UINT command = CommandByName(action);
  if (command >= 0)
    AppendMenuA(menu, MF_STRING, cmdBase + command, string);
}

INT abpWrapper::DoAccel(LPSTR action) {
  UINT command = CommandByName(action);
  if (command >= 0)
    return cmdBase + command;

  return 0;
}

void abpWrapper::DoRebar(HWND hRebar) {
  DWORD dwStyle = CCS_NODIVIDER | CCS_NOPARENTALIGN | CCS_NORESIZE |
    TBSTYLE_FLAT | TBSTYLE_TRANSPARENT | TBSTYLE_TOOLTIPS;

  HWND toolbar = kFuncs->CreateToolbar(GetParent(hRebar), dwStyle);
  if (!toolbar)
    return;

  TBBUTTON button = {0};
  button.iBitmap = 0;
  button.idCommand = cmdBase + CMD_TOOLBAR;
  button.fsState = TBSTATE_ENABLED;
  button.fsStyle = TBSTYLE_BUTTON;
  button.dwData = 0;
  button.iString = -1;

  SendMessage(toolbar, TB_BUTTONSTRUCTSIZE, (WPARAM)sizeof(button), 0);
  SendMessage(toolbar, TB_ADDBUTTONS, 1, (LPARAM)&button);

  int width, height;
  ImageList_GetIconSize(wrapper.hImages, &width, &height);
  SendMessage(toolbar, TB_SETBUTTONSIZE, 0, (LPARAM)MAKELONG(width, height));
  SendMessage(toolbar, TB_SETIMAGELIST, 0, (LPARAM)wrapper.hImages);

  DWORD dwBtnSize = SendMessage(toolbar, TB_GETBUTTONSIZE, 0, 0); 
  width = LOWORD(dwBtnSize);
  height = HIWORD(dwBtnSize);

  kFuncs->RegisterBand(toolbar, "Adblock Plus", TRUE);

  REBARBANDINFO rebar = {0};
  rebar.cbSize = sizeof(rebar);
  rebar.fMask  = RBBIM_ID | RBBIM_STYLE | RBBIM_CHILD | RBBIM_CHILDSIZE | RBBIM_SIZE | RBBIM_IDEALSIZE;
  rebar.wID = 'ABPP';
  rebar.fStyle = RBBS_CHILDEDGE;
  rebar.hwndChild  = toolbar;
  rebar.cxMinChild = width;
  rebar.cyMinChild = height;
  rebar.cyMaxChild = height;
  rebar.cxIdeal    = width;
  rebar.cx         = width;
  SendMessage(hRebar, RB_INSERTBAND, (WPARAM)-1, (LPARAM)&rebar);

  toolbarList.addToolbar(toolbar, hRebar);
}

LRESULT abpWrapper::WndProc(HWND hWnd, UINT message, WPARAM wParam, LPARAM lParam) {
  if (message == WM_COMMAND) {
    WORD command = LOWORD(wParam) - cmdBase;
    if (command == CMD_PREFERENCES) {
      abpJSContextHolder holder;
      JSObject* overlay = UnwrapNative(fakeBrowserWindow);
      jsval retval;
      if (holder.get() != nsnull && overlay != nsnull)
        JS_CallFunctionName(holder.get(), overlay, "abpSettings", 0, nsnull, &retval);
      return TRUE;
    }
    else if (command == CMD_LISTALL) {
      abpJSContextHolder holder;
      JSObject* overlay = UnwrapNative(fakeBrowserWindow);
      jsval retval;
      if (holder.get() != nsnull && overlay != nsnull)
        JS_CallFunctionName(holder.get(), overlay, "abpToggleSidebar", 0, nsnull, &retval);
      return TRUE;
    }
    else if (command == CMD_TOGGLEENABLED) {
      abpJSContextHolder holder;
      JSObject* overlay = UnwrapNative(fakeBrowserWindow);
      if (holder.get() != nsnull && overlay != nsnull) {
        char pref[] = "enabled";
        JSString* str = JS_NewStringCopyZ(holder.get(), pref);
        if (str != nsnull) {
          jsval retval;
          jsval args[] = {STRING_TO_JSVAL(str)};
          JS_CallFunctionName(holder.get(), overlay, "abpTogglePref", 1, args, &retval);
        }
      }
      return TRUE;
    }
    else if (command == CMD_IMAGE) {
      abpJSContextHolder holder;
      JSObject* overlay = UnwrapNative(fakeBrowserWindow);
      JSContext* cx = holder.get();
      if (cx != nsnull && overlay != nsnull) {
        jsval arg;
        jsval retval;
        if ((JS_GetProperty(cx, overlay, "abpBgData", &arg) && !JSVAL_IS_NULL(arg)) ||
            (JS_GetProperty(cx, overlay, "abpData", &arg) && !JSVAL_IS_NULL(arg)))
          JS_CallFunctionName(cx, overlay, "abpNode", 1, &arg, &retval);
      }
    }
    else if (command == CMD_OBJECT) {
      abpJSContextHolder holder;
      JSObject* overlay = UnwrapNative(fakeBrowserWindow);
      JSContext* cx = holder.get();
      if (cx != nsnull && overlay != nsnull) {
        jsval arg;
        jsval retval;
        if (JS_GetProperty(cx, overlay, "abpData", &arg) && !JSVAL_IS_NULL(arg))
          JS_CallFunctionName(cx, overlay, "abpNode", 1, &arg, &retval);
      }
    }
    else if (command == CMD_LINK) {
      abpJSContextHolder holder;
      JSObject* overlay = UnwrapNative(fakeBrowserWindow);
      JSContext* cx = holder.get();
      if (cx != nsnull && overlay != nsnull) {
        jsval arg;
        jsval retval;
        if (JS_GetProperty(cx, overlay, "abpLinkData", &arg) && !JSVAL_IS_NULL(arg))
          JS_CallFunctionName(cx, overlay, "abpNode", 1, &arg, &retval);
      }
    }
    else if (command == CMD_FRAME) {
      abpJSContextHolder holder;
      JSObject* overlay = UnwrapNative(fakeBrowserWindow);
      JSContext* cx = holder.get();
      if (cx != nsnull && overlay != nsnull) {
        jsval arg;
        jsval retval;
        if (JS_GetProperty(cx, overlay, "abpFrameData", &arg) && !JSVAL_IS_NULL(arg))
          JS_CallFunctionName(cx, overlay, "abpNode", 1, &arg, &retval);
      }
    }
    else if (command == CMD_TOOLBAR) {
      abpJSContextHolder holder;
      JSObject* overlay = UnwrapNative(fakeBrowserWindow);
      JSContext* cx = holder.get();
      if (cx != nsnull && overlay != nsnull) {
        jsval retval;
        // FIXME: Need to pass event parameter to allow opening context menu
        JS_CallFunctionName(cx, overlay, "abpCommandHandler", 0, nsnull, &retval);
      }
    }
  }
  else if (message == TB_MBUTTONDOWN && (wParam == cmdBase + CMD_TOOLBAR || wParam == cmdBase + CMD_STATUSBAR)) {
    abpJSContextHolder holder;
    char param[] = "enabled";
    JSObject* overlay = UnwrapNative(fakeBrowserWindow);
    JSContext* cx = holder.get();
    JSString* str = nsnull;
    if (cx)
      str = JS_NewString(cx, param, strlen(param));
    if (cx != nsnull && overlay != nsnull && str != nsnull) {
      jsval arg = STRING_TO_JSVAL(str);
      jsval retval;
      JS_CallFunctionName(cx, overlay, "abpTogglePref", 1, &arg, &retval);
    }
  }
  else if (message == WM_SETFOCUS) {
    nsIDOMWindow* wnd = activeWindows.getWindow(hWnd);
    if (wnd && wnd != currentWindow) {
      currentWindow = wnd;
      selectListeners.notifyListeners();
    }
  }
  else if (message == WM_SIZE && setNextWidth > 0) {
    // Fix up window size
    RECT screen;
    SystemParametersInfo(SPI_GETWORKAREA, NULL, &screen, 0);
  
    int width = setNextWidth;
    int height = setNextHeight;
    int left = (screen.left + screen.right - width) / 2;
    int top = (screen.top + screen.bottom - height) / 2;

    setNextWidth = 0;
    setNextHeight = 0;
    MoveWindow(hWnd, left, top, width, height, true);
  }

  if (IsWindowUnicode(hWnd))
    return CallWindowProcW((WNDPROC)origWndProc, hWnd, message, wParam, lParam);
  else
    return CallWindowProcA((WNDPROC)origWndProc, hWnd, message, wParam, lParam);
}

LRESULT CALLBACK abpWrapper::HookProc(int nCode, WPARAM wParam, LPARAM lParam) {
  if (nCode == HC_ACTION) {
    CWPRETSTRUCT* params = (CWPRETSTRUCT*)lParam;
    if (params->message == WM_DRAWITEM) {
      DRAWITEMSTRUCT* dis = (DRAWITEMSTRUCT*)params->lParam;
      WORD id = dis->itemID - cmdBase;
      if (dis->CtlType == ODT_MENU && id < NUM_COMMANDS)
        ImageList_Draw(wrapper.hImages, 0, dis->hDC, dis->rcItem.left + 1, dis->rcItem.top + 1, ILD_TRANSPARENT);
    }
  }

  return CallNextHookEx(hook, nCode, wParam, lParam);
}

/******************************
 * nsISupports implementation *
 ******************************/

NS_IMPL_ISUPPORTS5(abpWrapper, nsIDOMEventListener, nsIObserver, imgIDecoderObserver, nsIClassInfo, nsIXPCScriptable)

/**************************************
 * nsIDOMEventListener implementation *
 **************************************/

nsresult abpWrapper::HandleEvent(nsIDOMEvent* event) {
  nsresult rv;

  abpJSContextHolder holder;
  JSObject* overlay = UnwrapNative(fakeBrowserWindow);
  JSContext* cx = holder.get();
  if (cx == nsnull || overlay == nsnull)
    return NS_ERROR_FAILURE;

  nsCOMPtr<nsIDOMEventTarget> target;
  rv = event->GetTarget(getter_AddRefs(target));
  if (NS_FAILED(rv) || target == nsnull)
    return NS_ERROR_FAILURE;

  nsCOMPtr<nsIXPConnect> xpc = do_GetService(nsIXPConnect::GetCID());
  if (xpc == nsnull)
    return NS_ERROR_FAILURE;

  nsCOMPtr<nsIXPConnectJSObjectHolder> wrapperHolder;
  rv = xpc->WrapNative(cx, JS_GetParent(cx, overlay), target, NS_GET_IID(nsIDOMEventTarget), getter_AddRefs(wrapperHolder));
  if (NS_FAILED(rv))
    return rv;

  JSObject* jsObj;
  rv = wrapperHolder->GetJSObject(&jsObj);
  if (NS_FAILED(rv))
    return rv;

  jsval value = OBJECT_TO_JSVAL(jsObj);
  if (!JS_SetProperty(cx, overlay, "target", &value))
    return NS_ERROR_FAILURE;

  ResetContextMenu();
  JS_CallFunctionName(cx, overlay, "abpCheckContext", 0, nsnull, &value);

  return NS_OK;
}

/******************************
 * nsIObserver implementation *
 ******************************/

nsresult abpWrapper::Observe(nsISupports* subject, const char* topic, const PRUnichar* data) {
  nsCOMPtr<nsIDOMWindow> contentWnd = do_QueryInterface(subject);
  if (contentWnd == nsnull)
    return NS_ERROR_FAILURE;

  if (!IsBrowserWindow(contentWnd))
    return NS_OK;

  if (strcmp(topic, "domwindowopened") == 0) {
    HWND hWnd = GetHWND(contentWnd);
    activeWindows.addWindow(hWnd, contentWnd);

    nsCOMPtr<nsPIDOMWindow> privateWnd = do_QueryInterface(contentWnd);
    if (privateWnd == nsnull)
      return NS_ERROR_FAILURE;

    nsPIDOMWindow* rootWnd = privateWnd->GetPrivateRoot();
    if (rootWnd == nsnull)
      return NS_ERROR_FAILURE;

    nsIChromeEventHandler* chromeHandler = rootWnd->GetChromeEventHandler();
    if (chromeHandler == nsnull)
      return NS_ERROR_FAILURE;

    nsCOMPtr<nsIDOMEventTarget> target = do_QueryInterface(chromeHandler);
    if (target == nsnull)
      return NS_ERROR_FAILURE;

    target->AddEventListener(NS_LITERAL_STRING("contextmenu"), this, true);
  }
  else if (strcmp(topic, "domwindowclosed") == 0)
    activeWindows.removeWindow(contentWnd);

  return NS_OK;
}

/**************************************
 * imgIDecoderObserver implementation *
 **************************************/

nsresult abpWrapper::OnStopFrame(imgIRequest* aRequest, gfxIImageFrame *aFrame) {
  nsresult rv;

  gfx_format format;
  rv = aFrame->GetFormat(&format);
  if (NS_FAILED(rv))
    return rv;

  if (format != gfxIFormats::BGR_A8)
    return NS_ERROR_FAILURE;

  PRInt32 width;
  rv = aFrame->GetWidth(&width);
  if (NS_FAILED(rv))
    return rv;

  PRInt32 height;
  rv = aFrame->GetHeight(&height);
  if (NS_FAILED(rv))
    return rv;

  PRUint32 imageBytesPerRow;
  rv = aFrame->GetImageBytesPerRow(&imageBytesPerRow);
  if (NS_FAILED(rv))
    return rv;

  PRUint8* imageBits;
  PRUint32 imageSize;
  rv = aFrame->GetImageData(&imageBits, &imageSize);
  if (NS_FAILED(rv))
    return rv;

  PRUint32 alphaBytesPerRow;
  rv = aFrame->GetAlphaBytesPerRow(&alphaBytesPerRow);
  if (NS_FAILED(rv))
    return rv;

  PRUint8* alphaBits;
  PRUint32 alphaSize;
  rv = aFrame->GetAlphaData(&alphaBits, &alphaSize);
  if (NS_FAILED(rv))
    return rv;

  HDC hDC = ::GetDC(NULL);

  PRUint8* bits = new PRUint8[imageSize + alphaSize];

  for (PRUint32 i = 0, j = 0, n = 0; i < imageSize && j < alphaSize && n < imageSize + alphaSize;) {
    bits[n++] = imageBits[i++];
    bits[n++] = imageBits[i++];
    bits[n++] = imageBits[i++];
    bits[n++] = alphaBits[j++];
  }

  BITMAPINFOHEADER head;
  head.biSize = sizeof(head);
  head.biWidth = width;
  head.biHeight = height;
  head.biPlanes = 1;
  head.biBitCount = 32;
  head.biCompression = BI_RGB;
  head.biSizeImage = imageSize + alphaSize;
  head.biXPelsPerMeter = 0;
  head.biYPelsPerMeter = 0;
  head.biClrUsed = 0;
  head.biClrImportant = 0;

  HBITMAP image = ::CreateDIBitmap(hDC, NS_REINTERPRET_CAST(CONST BITMAPINFOHEADER*, &head),
                                   CBM_INIT, bits, NS_REINTERPRET_CAST(CONST BITMAPINFO*, &head),
                                   DIB_RGB_COLORS);
  delete bits;

  ImageList_Add(hImages, image, NULL);
  DeleteObject(image);

  ReleaseDC(NULL, hDC);

  return NS_OK;
}

nsresult abpWrapper::OnStartDecode(imgIRequest* aRequest) {
  return NS_OK;
}
nsresult abpWrapper::OnStartContainer(imgIRequest* aRequest, imgIContainer *aContainer) {
  return NS_OK;
}
nsresult abpWrapper::OnStartFrame(imgIRequest* aRequest, gfxIImageFrame *aFrame) {
  return NS_OK;
}
nsresult abpWrapper::OnDataAvailable(imgIRequest *aRequest, gfxIImageFrame *aFrame, const nsIntRect * aRect) {
  return NS_OK;
}
nsresult abpWrapper::OnStopContainer(imgIRequest* aRequest, imgIContainer *aContainer) {
  return NS_OK;
}
nsresult abpWrapper::OnStopDecode(imgIRequest* aRequest, nsresult status, const PRUnichar *statusArg) {
  LoadImage(currentImage + 1);
  return NS_OK;
}
nsresult abpWrapper::FrameChanged(imgIContainer *aContainer, gfxIImageFrame *aFrame, nsIntRect * aDirtyRect) {
  return NS_OK;
}

/*******************************
 * nsIClassInfo implementation *
 *******************************/

NS_METHOD abpWrapper::GetContractID(char** retval) {
  NS_ENSURE_ARG_POINTER(retval);

  // Need to set this, otherwise K-Meleon will crash (???)
  *retval = "";

  return NS_ERROR_NOT_AVAILABLE;
}

NS_METHOD abpWrapper::GetClassDescription(char** retval) {
  return NS_ERROR_NOT_AVAILABLE;
}

NS_METHOD abpWrapper::GetClassID(nsCID** retval) {
  return NS_ERROR_NOT_AVAILABLE;
}

NS_METHOD abpWrapper::GetImplementationLanguage(PRUint32* retval) {
  NS_ENSURE_ARG_POINTER(retval);

  *retval = nsIProgrammingLanguage::JAVASCRIPT;

  return NS_OK;
}

NS_METHOD abpWrapper::GetFlags(PRUint32* retval) {
  NS_ENSURE_ARG_POINTER(retval);

  *retval = nsIClassInfo::MAIN_THREAD_ONLY | nsIClassInfo::DOM_OBJECT;

  return NS_OK;
}

NS_METHOD abpWrapper::GetClassIDNoAlloc(nsCID* retval) {
  return NS_ERROR_NOT_AVAILABLE;
}

NS_METHOD abpWrapper::GetHelperForLanguage(PRUint32 language, nsISupports** retval) {
  NS_ENSURE_ARG_POINTER(retval);

  *retval = NS_STATIC_CAST(nsIClassInfo*, this);
  NS_ADDREF(this);

  return NS_OK;
}

NS_METHOD abpWrapper::GetInterfaces(PRUint32* count, nsIID*** array) {
  NS_ENSURE_ARG_POINTER(count);
  NS_ENSURE_ARG_POINTER(array);

  *count = 0;
  *array = nsnull;

  return NS_OK;
}

/***********************************
 * nsIXPCScriptable implementation *
 ***********************************/

NS_METHOD abpWrapper::GetClassName(char** retval) {
  NS_ENSURE_ARG_POINTER(retval);

  *retval = "abpWrapper";

  return NS_OK;
}

NS_METHOD abpWrapper::GetScriptableFlags(PRUint32* retval) {
  NS_ENSURE_ARG_POINTER(retval);

  *retval = nsIXPCScriptable::WANT_GETPROPERTY | nsIXPCScriptable::WANT_NEWRESOLVE;

  return NS_OK;
}

NS_METHOD abpWrapper::GetProperty(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, jsval id, jsval* vp, PRBool* _retval) {
  nsresult rv = NS_OK;

  JSString* property = JS_ValueToString(cx, id);
  if (property == nsnull)
    return NS_ERROR_FAILURE;

  nsCOMPtr<nsISupports> native;
  rv = wrapper->GetNative(getter_AddRefs(native));
  if (NS_FAILED(rv))
    return rv;

  JSObject* innerObj = UnwrapNative(native);
  if (innerObj == nsnull)
    return NS_ERROR_FAILURE;

  if (!JS_GetUCProperty(cx, innerObj, JS_GetStringChars(property), JS_GetStringLength(property), vp))
    return NS_ERROR_FAILURE;

  return rv;
}

NS_METHOD abpWrapper::NewResolve(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, jsval id, PRUint32 flags, JSObject** objp, PRBool* _retval) {
  nsresult rv = NS_OK;
  *_retval = PR_FALSE;

  nsCOMPtr<nsISupports> native;
  rv = wrapper->GetNative(getter_AddRefs(native));
  if (NS_FAILED(rv))
    return rv;

  JSObject* innerObj = UnwrapNative(native);
  if (innerObj == nsnull)
    return NS_ERROR_FAILURE;

  *objp = innerObj;
  *_retval = PR_TRUE;

  return NS_OK;
}

NS_METHOD abpWrapper::PreCreate(nsISupports* nativeObj, JSContext* cx, JSObject* globalObj, JSObject** parentObj) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpWrapper::Create(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpWrapper::PostCreate(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpWrapper::AddProperty(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, jsval id, jsval* vp, PRBool* _retval) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpWrapper::DelProperty(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, jsval id, jsval* vp, PRBool* _retval) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpWrapper::SetProperty(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, jsval id, jsval* vp, PRBool* _retval) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpWrapper::Enumerate(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, PRBool* _retval) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpWrapper::NewEnumerate(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, PRUint32 enum_op, jsval* statep, jsid* idp, PRBool* _retval) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpWrapper::Convert(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, PRUint32 type, jsval* vp, PRBool* _retval) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpWrapper::Finalize(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpWrapper::CheckAccess(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, jsval id, PRUint32 mode, jsval* vp, PRBool* _retval) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpWrapper::Call(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, PRUint32 argc, jsval* argv, jsval* vp, PRBool* _retval) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpWrapper::Construct(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, PRUint32 argc, jsval* argv, jsval* vp, PRBool* _retval) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpWrapper::HasInstance(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, jsval val, PRBool* bp, PRBool* _retval) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpWrapper::Mark(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, void* arg, PRUint32* _retval) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpWrapper::Equality(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, jsval val, PRBool* _retval) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpWrapper::OuterObject(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, JSObject** _retval) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpWrapper::InnerObject(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, JSObject** _retval) {
  return NS_ERROR_NOT_IMPLEMENTED;
}

/**************************
 * JS object manupulation *
 **************************/

PRBool abpWrapper::PatchComponent(JSContext* cx) {
  nsresult rv;

  nsCOMPtr<nsIScriptSecurityManager> secman = do_GetService(NS_SCRIPTSECURITYMANAGER_CONTRACTID);
  if (secman == nsnull) {
    JS_ReportError(cx, "Adblock Plus: Failed to retrieve security manager - wrong Gecko version?");
    return PR_FALSE;
  }

  rv = secman->GetSystemPrincipal(getter_AddRefs(systemPrincipal));
  if (NS_FAILED(rv) || systemPrincipal == nsnull) {
    JS_ReportError(cx, "Adblock Plus: Failed to retrieve system's security principal");
    return PR_FALSE;
  }

  nsCOMPtr<nsISupports> abp = do_CreateInstance(ADBLOCKPLUS_CONTRACTID);
  if (abp == nsnull) {
    // Maybe the component isn't registered yet? Try registering it.
    nsCOMPtr<nsIComponentRegistrar> compReg;
    rv = NS_GetComponentRegistrar(getter_AddRefs(compReg));
    if (NS_FAILED(rv) || compReg == nsnull) {
      JS_ReportError(cx, "Adblock Plus: Failed to retrieve component registrar - wrong Gecko version?");
      return PR_FALSE;
    }

    nsCOMPtr<nsIProperties> dirService = do_GetService("@mozilla.org/file/directory_service;1");
    if (dirService == nsnull) {
      JS_ReportError(cx, "Adblock Plus: Failed to retrieve directory service - wrong Gecko version?");
      return PR_FALSE;
    }

    nsCOMPtr<nsILocalFile> compFile;
    rv = dirService->Get(NS_XPCOM_COMPONENT_DIR, NS_GET_IID(nsILocalFile), getter_AddRefs(compFile));
    if (NS_FAILED(rv)) {
      JS_ReportError(cx, "Adblock Plus: Failed to retrieve components directory");
      return PR_FALSE;
    }

    compFile->AppendRelativePath(NS_LITERAL_STRING("nsAdblockPlus.js"));
    rv = compReg->AutoRegister(compFile);
    if (NS_FAILED(rv)) {
      JS_ReportError(cx, "Adblock Plus: Failed to register nsAdblockPlus.js");
      return PR_FALSE;
    }

    abp = do_CreateInstance(ADBLOCKPLUS_CONTRACTID);
  }
  if (abp == nsnull) {
    JS_ReportError(cx, "Adblock Plus: Failed to retrieve Adblock Plus component");
    return PR_FALSE;
  }

  JSObject* jsObject = UnwrapNative(abp);
  if (jsObject == nsnull) {
    JS_ReportError(cx, "Adblock Plus: Failed extracting JavaScript object from Adblock Plus component");
    return PR_FALSE;
  }

  if (!JS_DefineFunctions(cx, jsObject, component_methods)) {
    JS_ReportError(cx, "Adblock Plus: Failed to patch up Adblock Plus component methods");
    return PR_FALSE;
  }

  JSBool found;
  JS_SetPropertyAttributes(cx, JS_GetParent(cx, jsObject), "windowMediator", JSPROP_ENUMERATE | JSPROP_PERMANENT, &found);

  jsval value = OBJECT_TO_JSVAL(jsObject);
  if (!JS_SetProperty(cx, JS_GetParent(cx, jsObject), "windowMediator", &value)) {
    JS_ReportError(cx, "Adblock Plus: Failed to replace window mediator in Adblock Plus component");
    return PR_FALSE;
  }

  if (!CreateFakeBrowserWindow(cx, JS_GetParent(cx, jsObject)))
    return PR_FALSE;

  return PR_TRUE;
}

PRBool abpWrapper::CreateFakeBrowserWindow(JSContext* cx, JSObject* parent) {
  nsresult rv;
  jsval value;

  JSObject* obj = JS_NewObject(cx, nsnull, nsnull, parent);
  if (obj == nsnull) {
    JS_ReportError(cx, "Adblock Plus: Failed to create fake browser window object - out of memory?");
    return PR_FALSE;
  }
  JS_SetGlobalObject(cx, obj);

  if (!JS_DefineFunctions(cx, obj, browser_methods)) {
    JS_ReportError(cx, "Adblock Plus: Failed to attach native methods to fake browser window");
    return PR_FALSE;
  }

  if (!JS_DefineProperties(cx, obj, browser_properties)) {
    JS_ReportError(cx, "Adblock Plus: Failed to attach native properties to fake browser window");
    return PR_FALSE;
  }

  nsCOMPtr<nsIXPConnect> xpc = do_GetService(nsIXPConnect::GetCID());
  if (xpc == nsnull) {
    JS_ReportError(cx, "Adblock Plus: Coult not retrieve nsIXPConnect - wrong Gecko version?");
    return PR_FALSE;
  }

  const char* qiArgNames[] = {"iid"};
  char qiBody[] = " \
    if (iid.equals(Components.interfaces.nsISupports) || \
        iid.equals(Components.interfaces.nsIDOMWindow) || \
        iid.equals(Components.interfaces.nsIDOMWindowInternal)) \
      return this; \
\
    if (iid.equals(Components.interfaces.nsIClassInfo)) \
      return this.wrapper; \
\
    throw Components.results.NS_ERROR_NO_INTERFACE; \
";
  JSFunction* qiFunc = JS_CompileFunction(cx, obj, "QueryInterface", 1, qiArgNames, qiBody, strlen(qiBody), "adblockplus.dll inline script", 0);
  if (qiFunc == nsnull) {
    JS_ReportError(cx, "Adblock Plus: Failed to compile QueryInterface method for fake browser window");
    return PR_FALSE;
  }

  value = OBJECT_TO_JSVAL(JS_GetFunctionObject(qiFunc));
  if (!JS_SetProperty(cx, obj, "QueryInterface", &value)) {
    JS_ReportError(cx, "Adblock Plus: Failed to attach QueryInterface method to fake browser window");
    return PR_FALSE;
  }

  nsCOMPtr<nsISupports> wrapped;
  rv = xpc->WrapJS(cx, obj, NS_GET_IID(nsISupports), getter_AddRefs(wrapped));
  if (NS_FAILED(rv)) {
    JS_ReportError(cx, "Adblock Plus: Failed to create XPConnect wrapper for fake browser window");
    return PR_FALSE;
  }

  fakeBrowserWindow = do_QueryInterface(wrapped);
  if (fakeBrowserWindow == nsnull) {
    JS_ReportError(cx, "Adblock Plus: Failed to QI fake browser window");
    return PR_FALSE;
  }

  JSPrincipals* principals;
  rv = systemPrincipal->GetJSPrincipals(cx, &principals);
  if (NS_FAILED(rv)) {
    JS_ReportError(cx, "Adblock Plus: Could not convert system principal into JavaScript principals");
    return PR_FALSE;
  }

  const char* overlayLoadBody = " \
    var CSSPrimitiveValue = Components.interfaces.nsIDOMCSSPrimitiveValue; \
    var window = this; \
    var document = this; \
    var location = this; \
    var documentElement = this; \
    var parentNode = this; \
    var style = this; \
    var gContextMenu = this; \
    Components.classes['@mozilla.org/moz/jssubscript-loader;1'].getService(Components.interfaces.mozIJSSubScriptLoader).loadSubScript('chrome://adblockplus/content/overlay.js', this); \
  ";
  JSScript* overlayLoadScript = JS_CompileScriptForPrincipals(cx, obj, principals, overlayLoadBody, strlen(overlayLoadBody), "adblockplus.dll inline script", 0);
  if (overlayLoadScript == nsnull) {
    JSPRINCIPALS_DROP(cx, principals);
    JS_ReportError(cx, "Adblock Plus: Failed to compile overlay.js loading script");
    return PR_FALSE;
  }

  char parseDTD[] = " \
    var unicodeConverter = Components.classes['@mozilla.org/intl/scriptableunicodeconverter'].createInstance(Components.interfaces.nsIScriptableUnicodeConverter); \
    unicodeConverter.charset = '" ABP_CHARSET "'; \
    var overlayDTD = function() { \
      var request = Components.classes['@mozilla.org/xmlextras/xmlhttprequest;1'].createInstance(Components.interfaces.nsIXMLHttpRequest); \
      request.open('GET', 'chrome://adblockplus/locale/overlay.dtd', false); \
      request.send(null); \
\
      var ret = {}; \
      ret.__proto__ = null; \
      request.responseText.replace(/<!ENTITY\\s+([\\w.]+)\\s+\"([^\"]+?)\">/ig, function(match, key, value) {ret[key] = value}); \
\
      for (var key in ret) { \
        if (/(.*)\\.label$/.test(key)) { \
          var base = RegExp.$1; \
          var value = ret[key]; \
          if (base + '.accesskey' in ret) \
            value = value.replace(new RegExp(ret[base + '.accesskey'], 'i'), '&$&'); \
          ret[base] = value; \
        } \
      } \
\
      return ret; \
    }(); \
    function getOverlayEntity(name) { \
      var ellipsis = false; \
      if (/\\.\\.\\.$/.test(name)) { \
        ellipsis = true; \
        name = name.replace(/\\.\\.\\.$/, ''); \
      } \
      var ret = (name in overlayDTD ? overlayDTD[name] : name) + (ellipsis ? '...' : ''); \
      return unicodeConverter.ConvertFromUnicode(ret); \
    } \
";
  JSScript* parseDTDScript = JS_CompileScriptForPrincipals(cx, obj, principals, parseDTD, strlen(parseDTD), "adblockplus.dll inline script", 0);
  JSPRINCIPALS_DROP(cx, principals);
  if (parseDTDScript == nsnull) {
    JS_ReportError(cx, "Adblock Plus: Failed to compile overlay.dtd parsing script");
    return PR_FALSE;
  }

  if (!JS_ExecuteScript(cx, obj, overlayLoadScript, &value)) {
    JS_ReportError(cx, "Adblock Plus: Failed to load overlay.js");
    return PR_FALSE;
  }

  if (!JS_ExecuteScript(cx, obj, parseDTDScript, &value)) {
    JS_ReportError(cx, "Adblock Plus: Failed to load overlay.dtd");
    return PR_FALSE;
  }

  JS_DestroyScript(cx, overlayLoadScript);
  JS_DestroyScript(cx, parseDTDScript);

  for (int i = 0; i < NUM_LABELS; i++) {
    JSString* str = JS_NewStringCopyZ(cx, labels[i]);
    if (str == nsnull) {
      JS_ReportError(cx, "Adblock Plus: Could not create JavaScript string for '%s' - out of memory?", labels[i]);
      return PR_FALSE;
    }
  
    jsval args[] = {STRING_TO_JSVAL(str)};
    jsval retval;
    if (!JS_CallFunctionName(cx, obj, "getOverlayEntity", 1, args, &retval)) {
      JS_ReportError(cx, "Adblock Plus: Failed to retrieve entity '%s' from overlay.dtd", labels[i]);
      return PR_FALSE;
    }

    str = JS_ValueToString(cx, retval);
    if (str == nsnull) {
      JS_ReportError(cx, "Adblock Plus: Could not convert return value of getOverlayEntity() to string");
      return PR_FALSE;
    }

    strcpy_s(labelValues[i], sizeof(labelValues[i]), JS_GetStringBytes(str));
  }

  return PR_TRUE;
}

JSObject* abpWrapper::UnwrapNative(nsISupports* native) {
  nsCOMPtr<nsIXPConnectWrappedJS> holder = do_QueryInterface(native);
  if (holder == nsnull)
    return nsnull;

  JSObject* innerObj;
  nsresult rv = holder->GetJSObject(&innerObj);
  if (NS_FAILED(rv))
    return nsnull;

  return innerObj;
}


/********************
 * Helper functions *
 ********************/

PRBool abpWrapper::IsBrowserWindow(nsIDOMWindow* contentWnd) {
  nsresult rv;

  nsCOMPtr<nsIClassInfo> classInfo = do_QueryInterface(contentWnd);
  if (classInfo == nsnull)
    return PR_FALSE;

  char* descr;
  rv = classInfo->GetClassDescription(&descr);
  if (NS_FAILED(rv))
    return PR_FALSE;

  return (strcmp(descr, "Window") == 0 ? PR_TRUE : PR_FALSE);
}

HWND abpWrapper::GetHWND(nsIDOMWindow* wnd) {
  nsresult rv;

  nsCOMPtr<nsIWebBrowserChrome> chrome;
  rv = watcher->GetChromeForWindow(wnd, getter_AddRefs(chrome));
  if (NS_FAILED(rv) || chrome == nsnull)
    return NULL;

  nsCOMPtr<nsIEmbeddingSiteWindow> site = do_QueryInterface(chrome);
  if (site == nsnull)
    return NULL;

  HWND ret;
  rv = site->GetSiteWindow((void**)&ret);
  if (NS_FAILED(rv))
    return NULL;

  return ret;
}

INT abpWrapper::CommandByName(LPSTR action) {
  INT command = -1;
  if (_stricmp(action, "Preferences") == 0)
    command = CMD_PREFERENCES;
  else if (_stricmp(action, "ListAll") == 0)
    command = CMD_LISTALL;
  else if (_stricmp(action, "ToggleEnabled") == 0)
    command = CMD_TOGGLEENABLED;

  return command;
}

void abpWrapper::ReadAccelerator(nsIPrefBranch* branch, const char* pref, const char* command) {
  PRBool control = PR_FALSE;
  PRBool alt = PR_FALSE;
  PRBool shift = PR_FALSE;
  PRBool virt = PR_FALSE;
  char* key = nsnull;
  char buf[256] = "";

  char* part;
  char* next;
  nsresult rv = branch->GetCharPref(pref, &part);
  if (NS_FAILED(rv))
    return;

  for (char* c = part; *c; c++)
    if (*c >= 'a' && *c <= 'z')
      *c -= 'a' - 'A';

  while (part) {
    next = strchr(part, ' ');
    if (next)
      *next++ = 0;

    if (((part[0] >= 'A' && part[0] <= 'Z') || (part[0] >= '0' && part[0] <= '9')) && part[1] == 0) {
      key = part;
      virt = PR_FALSE;
    }
    else if (strcmp(part, "ACCEL") == 0 || strcmp(part, "CONTROL") == 0 || strcmp(part, "CTRL") == 0)
      control = PR_TRUE;
    else if (strcmp(part, "ALT") == 0)
      alt = PR_TRUE;
    else if (strcmp(part, "SHIFT") == 0)
      shift = PR_TRUE;
    else {
      int num = 0;
      int valid = 0;
      for (char* c = part; *c; c++,num++)
        if ((*c >= 'A' && *c <= 'Z') || (*c >= '0' && *c <= '9') || *c == '_')
          valid++;

      if (num > 1 && valid == num) {
        key = part;
        virt = PR_TRUE;
      }
    }
    part = next;
  }

  if (key != nsnull) {
    if (control)
      strcat_s(buf, sizeof buf, "CTRL ");
    if (alt)
      strcat_s(buf, sizeof buf, "ALT ");
    if (shift)
      strcat_s(buf, sizeof buf, "SHIFT ");
    if (virt)
      strcat_s(buf, sizeof buf, "VK_");
  
    strcat_s(buf, sizeof buf, key);

    strcat_s(buf, sizeof buf, " = ");
    strcat_s(buf, sizeof buf, command);
  
    kFuncs->ParseAccel(buf);
  }
}

JSObject* abpWrapper::OpenDialog(char* url, char* target, char* features) {
  nsresult rv;
  nsCOMPtr<nsIDOMWindow> wnd;

  rv = watcher->OpenWindow(fakeBrowserWindow, url, target, features, nsnull, getter_AddRefs(wnd));
  if (NS_FAILED(rv) || wnd == nsnull)
    return nsnull;

  if (strstr(url, "sidebarDetached.xul")) {
    SetWindowPos(hMostRecent, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_NOMOVE | SWP_NOSIZE);

    // Fix up sidebar dialog height
    setNextWidth = 300;
    setNextHeight = 600;
  }
  else if (strstr(url, "settings.xul"))
    settingsDlg = do_QueryInterface(wnd);

  return wrapper.GetGlobalObject(wnd);
}

JSObject* abpWrapper::GetGlobalObject(nsIDOMWindow* wnd) {
  nsCOMPtr<nsIScriptGlobalObject> global = do_QueryInterface(wnd);
  if (global == nsnull)
    return nsnull;

  return global->GetGlobalJSObject();
}

nsresult abpWrapper::OpenTab(const char* url) {
  nsresult rv = NS_OK;
  
  kFuncs->SendMessage("layers", PLUGIN_NAME, "AddLayersToWindow", (LONG)"1", (LONG)url);

  return rv;
}

nsresult abpWrapper::AddSelectListener(JSContext* cx, JSFunction* func) {
  selectListeners.addListener(cx, func);

  return NS_OK;
}

nsresult abpWrapper::RemoveSelectListener(JSFunction* func) {
  selectListeners.removeListener(func);

  return NS_OK;
}

void abpWrapper::Focus(nsIDOMWindow* wnd) {
  HWND hWnd = GetHWND(wnd);
  if (hWnd)
    BringWindowToTop(hWnd);
}

TCHAR* menus[] = {_T("DocumentPopup"), _T("DocumentImagePopup"), _T("TextPopup"),
                  _T("LinkPopup"), _T("ImageLinkPopup"), _T("ImagePopup"),
                  _T("FrameDocumentPopup"), _T("FrameDocumentImagePopup"), _T("FrameTextPopup"),
                  _T("FrameLinkPopup"), _T("FrameImageLinkPopup"), _T("FrameImagePopup"),
                  NULL};

void abpWrapper::AddContextMenuItem(WORD command, char* label) {
  MENUITEMINFO info = {0};
  info.cbSize = sizeof info;
  info.fMask = MIIM_TYPE;

  UINT drawFlag;
  for (int i = 0; menus[i]; i++) {
    HMENU hMenu = kFuncs->GetMenu(menus[i]);
    if (hMenu) {
      drawFlag = MF_OWNERDRAW;

      int count = GetMenuItemCount(hMenu);
      if (count > 0) {
        WORD id = GetMenuItemID(hMenu, count - 1) - cmdBase;
        if (id >= NUM_COMMANDS)
          AppendMenuA(hMenu, MF_SEPARATOR, cmdBase + CMD_SEPARATOR, NULL);

        // Only use MF_OWNERDRAW flag if other menu items have it as well
        if (GetMenuItemInfo(hMenu, 0, TRUE, &info) && !(info.fType & MFT_OWNERDRAW))
          drawFlag = MF_STRING;
      }
      AppendMenuA(hMenu, drawFlag, cmdBase + command, label);
    }
  }
}

void abpWrapper::ResetContextMenu() {
  for (int i = 0; menus[i]; i++) {
    HMENU hMenu = kFuncs->GetMenu(menus[i]);
    if (hMenu) {
      int count = GetMenuItemCount(hMenu);
      for (int j = 0; j < count; j++) {
        WORD id = GetMenuItemID(hMenu, j) - cmdBase;
        if (id < NUM_COMMANDS)
          RemoveMenu(hMenu, j--, MF_BYPOSITION);
      }
    }
  }
}

void abpWrapper::LoadImage(int index) {
  nsresult rv;

  currentImage = index;
  if (currentImage >= sizeof(images)/sizeof(images[0])) {
    toolbarList.invalidateToolbars();
    return;
  }

  nsCOMPtr<imgILoader> loader = do_GetService("@mozilla.org/image/loader;1");
  if (loader == nsnull)
    return;

  nsCOMPtr<nsIURI> uri;
  nsCString urlStr(images[index]);
  rv = ioService->NewURI(urlStr, nsnull, nsnull, getter_AddRefs(uri));
  if (NS_FAILED(rv))
    return;

  nsCOMPtr<imgIRequest> retval;
  rv = loader->LoadImage(uri, nsnull, nsnull, nsnull, this, nsnull,
                         nsIRequest::LOAD_NORMAL, nsnull, nsnull, getter_AddRefs(imageRequest));
  if (NS_FAILED(rv))
    return;

  return;
}
