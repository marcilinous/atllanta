// Atllanta field app — a thin Flutter shell that hosts the Atllanta web app in
// a WebView. The whole UI, offline outbox, and every feature come from the web
// app, so shipping web changes updates this app instantly with no store review.
//
// The shell's only jobs are: be an installable Android app, grant the WebView
// the OS permissions a PWA needs (camera for selfies, location for GPS), keep
// the browser chrome out of the way, and handle the hardware back button.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:permission_handler/permission_handler.dart';

// The deployed Atllanta web app this shell loads. CHANGE THIS to your
// production domain (your Vercel URL or custom domain). Everything downstream
// — auto-updates included — flows from here.
const String kAppUrl = 'https://atllanta.vercel.app';

// Hosts the WebView is allowed to open in-app. Anything else opens externally.
bool _isInternalHost(String host) {
  host = host.toLowerCase();
  return host.contains('atllanta') ||
      host.contains('vercel.app') ||
      host.contains('supabase');
}

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const AtllantaApp());
}

class AtllantaApp extends StatelessWidget {
  const AtllantaApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Atllanta',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(useMaterial3: true, colorSchemeSeed: const Color(0xFF2563EB)),
      home: const WebShell(),
    );
  }
}

class WebShell extends StatefulWidget {
  const WebShell({super.key});

  @override
  State<WebShell> createState() => _WebShellState();
}

class _WebShellState extends State<WebShell> {
  InAppWebViewController? _controller;
  late final PullToRefreshController _pullToRefresh;
  bool _loading = true;
  bool _error = false;

  @override
  void initState() {
    super.initState();
    _requestRuntimePermissions();
    _pullToRefresh = PullToRefreshController(
      settings: PullToRefreshSettings(color: const Color(0xFF2563EB)),
      onRefresh: () => _controller?.reload(),
    );
  }

  // The WebView cannot request dangerous OS permissions itself; the app must.
  Future<void> _requestRuntimePermissions() async {
    await [Permission.camera, Permission.location].request();
  }

  void _reload() {
    setState(() {
      _error = false;
      _loading = true;
    });
    _controller?.loadUrl(urlRequest: URLRequest(url: WebUri(kAppUrl)));
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvoked: (didPop) async {
        if (didPop) return;
        if (_controller != null && await _controller!.canGoBack()) {
          _controller!.goBack();
        } else {
          SystemNavigator.pop();
        }
      },
      child: Scaffold(
        backgroundColor: Colors.white,
        body: SafeArea(
          child: Stack(
            children: [
              InAppWebView(
                initialUrlRequest: URLRequest(url: WebUri(kAppUrl)),
                pullToRefreshController: _pullToRefresh,
                initialSettings: InAppWebViewSettings(
                  javaScriptEnabled: true,
                  // Let the camera fire without an extra user gesture, and play
                  // inline (so the selfie capture flow feels native).
                  mediaPlaybackRequiresUserGesture: false,
                  allowsInlineMediaPlayback: true,
                  // Storage the PWA relies on: localStorage/session, IndexedDB
                  // (the offline outbox), and geolocation.
                  domStorageEnabled: true,
                  databaseEnabled: true,
                  geolocationEnabled: true,
                  useOnDownloadStart: true,
                  supportZoom: false,
                  transparentBackground: true,
                  useShouldOverrideUrlLoading: true,
                ),
                onWebViewCreated: (controller) => _controller = controller,
                // Grant camera / microphone / anything the page asks for — the
                // OS runtime prompt already gated it above.
                onPermissionRequest: (controller, request) async {
                  return PermissionResponse(
                    resources: request.resources,
                    action: PermissionResponseAction.GRANT,
                  );
                },
                // Grant the page's origin access to device location.
                onGeolocationPermissionsShowPrompt: (controller, origin) async {
                  return GeolocationPermissionShowPromptResponse(
                    origin: origin,
                    allow: true,
                    retain: true,
                  );
                },
                onLoadStart: (controller, url) {
                  setState(() {
                    _loading = true;
                    _error = false;
                  });
                },
                onLoadStop: (controller, url) async {
                  _pullToRefresh.endRefreshing();
                  setState(() => _loading = false);
                },
                onReceivedError: (controller, request, error) {
                  _pullToRefresh.endRefreshing();
                  // Only surface the retry screen for a failed main-frame load.
                  if (request.isForMainFrame ?? false) {
                    setState(() {
                      _loading = false;
                      _error = true;
                    });
                  }
                },
                // Keep in-app navigation inside the WebView; hand off external
                // links (tel:, mailto:, other sites) to the system.
                shouldOverrideUrlLoading: (controller, action) async {
                  final uri = action.request.url;
                  if (uri == null) return NavigationActionPolicy.ALLOW;
                  final scheme = uri.scheme.toLowerCase();
                  if (scheme == 'tel' || scheme == 'mailto' || scheme == 'sms' || scheme == 'whatsapp') {
                    return NavigationActionPolicy.CANCEL; // let the OS handle it
                  }
                  if ((scheme == 'http' || scheme == 'https') && !_isInternalHost(uri.host)) {
                    return NavigationActionPolicy.CANCEL;
                  }
                  return NavigationActionPolicy.ALLOW;
                },
              ),
              if (_loading)
                const Center(
                  child: CircularProgressIndicator(color: Color(0xFF2563EB)),
                ),
              if (_error) _OfflineRetry(onRetry: _reload),
            ],
          ),
        ),
      ),
    );
  }
}

// Shown only when the app can't reach Atllanta at all (e.g. offline on the very
// first run before anything is cached). Once the web app has been cached by its
// service worker, it opens offline and this never appears.
class _OfflineRetry extends StatelessWidget {
  final VoidCallback onRetry;
  const _OfflineRetry({required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Container(
      color: Colors.white,
      alignment: Alignment.center,
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.wifi_off_rounded, size: 48, color: Color(0xFF6B7080)),
          const SizedBox(height: 12),
          const Text(
            "Can't reach Atllanta",
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: Color(0xFF1A1D23)),
          ),
          const SizedBox(height: 6),
          const Text(
            "Check your connection. Anything you saved offline will sync once you're back online.",
            textAlign: TextAlign.center,
            style: TextStyle(color: Color(0xFF6B7080)),
          ),
          const SizedBox(height: 20),
          FilledButton(onPressed: onRetry, child: const Text('Retry')),
        ],
      ),
    );
  }
}
