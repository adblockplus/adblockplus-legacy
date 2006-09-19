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

#define KMELEON_PLUGIN_EXPORTS
#include "KMeleonConst.h"
#include "kmeleon_plugin.h"
#include "Utils.h"

#define MOZILLA_STRICT_API
#include "nsISupports.h"
#include "nsCOMPtr.h"
#include "nsComponentManagerUtils.h"
#include "nsServiceManagerUtils.h"
#include "nsIInterfaceRequestorUtils.h"
#include "nsIWindowWatcher.h"
#include "nsIObserver.h"
#include "nsIDOMWindow.h"
#include "nsIDOMWindowInternal.h"
#include "nsPIDOMWindow.h"
#include "nsIXPConnect.h"
#include "nsIWebBrowser.h"
#include "nsIWebNavigation.h"
#include "nsIDOMEventTarget.h"
#include "nsIDOMEvent.h"
#include "nsIDOMDocument.h"
#include "nsIDOMElement.h"
#include "nsIURI.h"
#include "nsIJSContextStack.h"
#include "nsIScriptGlobalObject.h"
#include "nsIXPCScriptable.h"
#include "nsIChromeRegistrySea.h"
#include "nsIDOMEventReceiver.h"
#include "nsIDOMEventListener.h"
#include "nsIPromptService.h"
#include "nsITimer.h"
#include "nsIPrefBranch.h"
#include "nsIPrefService.h"
#include "nsIConsoleService.h"
#include "nsIScriptError.h"
#include "nsIScriptSecurityManager.h"
#include "nsIPrincipal.h"
#include "nsIWebBrowserChrome.h"
#include "nsIEmbeddingSiteWindow.h"
#include "nsIChromeEventHandler.h"
#include "imgIRequest.h"
#include "imgILoader.h"
#include "imgIDecoderObserver.h"
#include "gfxIImageFrame.h"
#include "nsIIOService.h"
#include "nsEmbedString.h"
#include "jsapi.h"
#include "prmem.h"

#define ABP_VERSION   "0.0"
#define ABP_LANGUAGE  "en-US"

#define PLUGIN_NAME "Adblock Plus " ABP_VERSION
#define ADBLOCKPLUS_CONTRACTID "@mozilla.org/adblockplus;1"

WORD cmdBase;
enum {CMD_PREFERENCES, CMD_LISTALL, CMD_TOGGLEENABLED, CMD_IMAGE, CMD_OBJECT, CMD_LINK, CMD_FRAME, CMD_SEPARATOR, CMD_NULL};
#define NUM_COMMANDS (CMD_NULL)

char* images[] = {
  "chrome://adblockplus/skin/abp-enabled-16.png",
  "chrome://adblockplus/skin/abp-disabled-16.png",
  "chrome://adblockplus/skin/abp-whitelisted-16.png",
  "chrome://adblockplus/skin/abp-defunc-16.png",
};

JS_STATIC_DLL_CALLBACK(void) Reporter(JSContext *cx, const char *message, JSErrorReport *rep);
JSBool JS_DLL_CALLBACK JSFocusDialog(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval);
JSBool JS_DLL_CALLBACK FakeGetMostRecentWindow(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval);
JSBool JS_DLL_CALLBACK JSOpenDialog(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval);
JSBool JS_DLL_CALLBACK FakeAddEventListener(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval);
JSBool JS_DLL_CALLBACK FakeRemoveEventListener(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval);
JSBool JS_DLL_CALLBACK FakeHasAttribute(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval);
JSBool JS_DLL_CALLBACK FakeGetAttribute(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval);
JSBool JS_DLL_CALLBACK FakeOpenTab(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval);
JSBool JS_DLL_CALLBACK FakeShowItem(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval);
JSBool JS_DLL_CALLBACK JSDummyFunction(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval);
JSBool JS_DLL_CALLBACK JSGetContentWindow(JSContext *cx, JSObject *obj, jsval id, jsval *vp);
JSBool JS_DLL_CALLBACK JSGetWrapper(JSContext *cx, JSObject *obj, jsval id, jsval *vp);

LONG DoMessage(LPCSTR to, LPCSTR from, LPCSTR subject, LONG data1, LONG data2);
LRESULT CALLBACK WndProc(HWND hWnd, UINT message, WPARAM wParam, LPARAM lParam);
LRESULT CALLBACK HookProc(int nCode, WPARAM wParam, LPARAM lParam);

kmeleonPlugin kPlugin = {
  KMEL_PLUGIN_VER,
  PLUGIN_NAME,
  DoMessage
};

extern "C" {
  KMELEON_PLUGIN kmeleonPlugin *GetKmeleonPlugin() {
    return &kPlugin;
  }
}

class abpJSContextHolder {
public:
  abpJSContextHolder() {
    mContext = nsnull;

    nsresult rv;
    mStack = do_GetService("@mozilla.org/js/xpc/ContextStack;1", &rv);
    if (NS_FAILED(rv))
      return;
  
    JSContext* cx;
    rv = mStack->GetSafeJSContext(&cx);
    if (NS_FAILED(rv))
      return;
  
    rv = mStack->Push(cx);
    if (NS_FAILED(rv))
      return;
  
    mContext = cx;
    mOldReporter = JS_SetErrorReporter(mContext, ::Reporter);
  }

  ~abpJSContextHolder() {
    if (mContext) {
      JS_SetErrorReporter(mContext, mOldReporter);

      nsresult rv;
      JSContext* cx;
      rv = mStack->Pop(&cx);
      NS_ASSERTION(NS_SUCCEEDED(rv) && cx == mContext, "JSContext push/pop mismatch");
    }
  }

  JSContext* get() {
    return mContext;
  }
private:
  nsCOMPtr<nsIThreadJSContextStack> mStack;
  JSContext* mContext;
  JSErrorReporter mOldReporter;
};

class abpListenerList {
public:
  abpListenerList() : functions(nsnull), listeners(0), bufSize(0) {}
  virtual ~abpListenerList() {
    if (functions != nsnull)
      PR_Free(functions);
  }
  void addListener(JSContext* cx, JSFunction* listener) {
    JS_SetParent(cx, JS_GetFunctionObject(listener), JS_GetGlobalObject(cx));
    for (int i = 0; i < listeners; i++) {
      if (functions[i] == listener)
        return;
      if (functions[i] == nsnull) {
        functions[i] = listener;
        return;
      }
    }
    if (listeners + 1 > bufSize) {
      bufSize += 8;
      if (functions == nsnull)
        functions = NS_STATIC_CAST(JSFunction**, PR_Malloc(bufSize * sizeof(JSFunction*)));
      else
        functions = NS_STATIC_CAST(JSFunction**, PR_Realloc(functions, bufSize * sizeof(JSFunction*)));
    }
    functions[listeners++] = listener;
  }
  void removeListener(JSFunction* listener) {
    for (int i = 0; i < listeners; i++)
      if (functions[i] == listener)
        functions[i] = nsnull;
  }
  void notifyListeners() {
    abpJSContextHolder holder;
    JSContext* cx = holder.get();
    if (cx == nsnull)
      return;

    for (int i = 0; i < listeners; i++) {
      if (functions[i] == nsnull)
        continue;

      jsval retval;
      jsval args[] = {JSVAL_VOID};
      JS_CallFunction(cx, JS_GetParent(cx, JS_GetFunctionObject(functions[i])), functions[i], 1, args, &retval);
    }
  }
private:
  int listeners;
  int bufSize;
  JSFunction** functions;
};

class abpWrapper : public nsIDOMEventListener, public nsIClassInfo, public nsIXPCScriptable, imgIDecoderObserver {
public:
  NS_DECL_ISUPPORTS
  NS_DECL_NSIDOMEVENTLISTENER
  NS_DECL_NSICLASSINFO
  NS_DECL_NSIXPCSCRIPTABLE
  NS_DECL_IMGIDECODEROBSERVER
  NS_DECL_IMGICONTAINEROBSERVER

  abpWrapper() : hCurrentBrowser(NULL), setNextWidth(0), setNextHeight(0) {
    hImages = ImageList_Create(16, 16, ILC_COLOR32, sizeof(images)/sizeof(images[0]), 0);
  };
  virtual ~abpWrapper() {
    ImageList_Destroy(hImages);
  };

  virtual PRBool Load();
  virtual void Setup();
  virtual void Create(HWND parent);
  virtual void Quit();
  virtual void DoMenu(HMENU menu, LPSTR action, LPSTR string);
  virtual INT DoAccel(LPSTR action);
  virtual LRESULT WndProc(HWND hWnd, UINT message, WPARAM wParam, LPARAM lParam);
  virtual LRESULT HookProc(int nCode, WPARAM wParam, LPARAM lParam);
  virtual JSObject* OpenDialog(char* url, char* target, char* features);
  virtual nsresult OpenTab(const char* url);
  virtual nsresult AddSelectListener(JSContext* cx, JSFunction* func);
  virtual nsresult RemoveSelectListener(JSFunction* func);
  virtual nsIDOMWindowInternal* GetBrowserWindow() {return fakeBrowserWindow;}
  virtual nsIDOMWindowInternal* GetSettingsWindow() {return settingsDlg;}
  virtual nsIDOMWindow* GetCurrentWindow();
  virtual JSObject* GetGlobalObject(nsIDOMWindow* wnd);
  virtual JSObject* UnwrapNative(nsISupports* native);
  virtual void Focus(nsIDOMWindow* wnd);
  virtual void AddContextMenuItem(WORD command, char* label);
  virtual void ResetContextMenu();
protected:
  kmeleonFunctions* kFuncs;
  WORD cmdBase;
  void* origWndProc;
  HWND hMostRecent;
  HWND hCurrentBrowser;
  nsCOMPtr<nsIWindowWatcher> watcher;
  nsCOMPtr<nsIIOService> ioService;
  nsCOMPtr<nsIDOMWindowInternal> settingsDlg;
  nsCOMPtr<nsIDOMWindowInternal> fakeBrowserWindow;
  nsCOMPtr<nsIPrincipal> systemPrincipal;
  abpListenerList selectListeners;
  int setNextWidth;
  int setNextHeight;

  nsCOMPtr<imgIRequest> imageRequest;
  int currentImage;
  HIMAGELIST hImages;
  HHOOK hook;

  virtual PRBool PatchComponent();
  virtual PRBool CreateFakeBrowserWindow(JSContext* cx, JSObject* parent);
  virtual PRBool IsBrowserWindow(HWND wnd);
  virtual INT CommandByName(LPSTR action);
  virtual void ReadAccelerator(nsIPrefBranch* branch, const char* pref, const char* command);
  virtual void LoadImage(int index);
};
