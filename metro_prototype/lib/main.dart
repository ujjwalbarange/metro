import 'package:flutter/material.dart';
import 'dart:js_interop';
import 'dart:js_interop_unsafe';
import 'dart:convert';
import 'dart:async';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const MetroApp());
}

class MetroApp extends StatelessWidget {
  const MetroApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Nagpur Metro 3D',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        brightness: Brightness.dark,
        colorSchemeSeed: Colors.orange,
        fontFamily: 'Segoe UI',
      ),
      home: const MapScreen(),
    );
  }
}

class MapScreen extends StatefulWidget {
  const MapScreen({super.key});
  @override
  State<MapScreen> createState() => _MapScreenState();
}

class _MapScreenState extends State<MapScreen> {
  // Station click data
  String? _clickedStationName;
  double? _clickedLng, _clickedLat;

  // Routing state
  bool _showRoutingPanel = false;
  String _fromText = 'Your Location';
  String? _toStation;
  List<String> _stationNames = [];
  Map<String, dynamic>? _routeResult;
  bool _isRouteLoading = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _initMap());
  }

  void _initMap() {
    try {
      final initFn = globalContext['__metro3d_init'];
      if (initFn != null && initFn.typeofEquals('function')) {
        (initFn as JSFunction).callAsFunction();
        // Listen for station click events from JS
        _listenForStationClicks();
        // Load station names after a delay (give JS time to load)
        Future.delayed(const Duration(seconds: 3), _loadStationNames);
      } else {
        Future.delayed(const Duration(milliseconds: 300), _initMap);
      }
    } catch (e) {
      debugPrint('Error initializing map: $e');
      Future.delayed(const Duration(milliseconds: 300), _initMap);
    }
  }

  void _listenForStationClicks() {
    // Use JS interop to listen for custom events
    final handler = ((JSObject event) {
      final detail = event['detail'] as JSObject?;
      if (detail != null) {
        final name = (detail['name'] as JSString?)?.toDart;
        final lng = (detail['lng'] as JSNumber?)?.toDartDouble;
        final lat = (detail['lat'] as JSNumber?)?.toDartDouble;
        if (name != null) {
          setState(() {
            _clickedStationName = name;
            _clickedLng = lng;
            _clickedLat = lat;
          });
        }
      }
    }).toJS;

    globalContext.callMethod(
      'addEventListener'.toJS,
      'metro3d_station_click'.toJS,
      handler,
    );
  }

  void _loadStationNames() {
    try {
      final fn = globalContext['__metro3d_getStationNames'];
      if (fn != null && fn.typeofEquals('function')) {
        final result = (fn as JSFunction).callAsFunction() as JSString?;
        if (result != null) {
          final list = jsonDecode(result.toDart) as List;
          setState(() {
            _stationNames = list.cast<String>();
          });
          debugPrint('Loaded ${_stationNames.length} station names');
        }
      }
    } catch (e) {
      debugPrint('Error loading station names: $e');
      // Retry
      Future.delayed(const Duration(seconds: 2), _loadStationNames);
    }
  }

  Future<void> _calculateRoute() async {
    if (_toStation == null) return;
    setState(() { _isRouteLoading = true; });

    try {
      // Use center of Nagpur as "Your Location" fallback
      final fromLng = _clickedLng ?? 79.0882;
      final fromLat = _clickedLat ?? 21.1458;

      final fn = globalContext['__metro3d_calculateRoute'];
      if (fn != null && fn.typeofEquals('function')) {
        final promise = (fn as JSFunction).callAsFunction(
          null,
          fromLng.toJS,
          fromLat.toJS,
          _toStation!.toJS,
        );
        // Await the JS promise
        final result = await (promise as JSPromise).toDart;
        if (result != null) {
          final jsonStr = (result as JSString).toDart;
          setState(() {
            _routeResult = jsonDecode(jsonStr);
            _isRouteLoading = false;
          });
        } else {
          setState(() { _isRouteLoading = false; });
        }
      }
    } catch (e) {
      debugPrint('Route calculation error: $e');
      setState(() { _isRouteLoading = false; });
    }
  }

  void _clearRoute() {
    try {
      final fn = globalContext['__metro3d_clearRoute'];
      if (fn != null && fn.typeofEquals('function')) {
        (fn as JSFunction).callAsFunction();
      }
    } catch (_) {}
    setState(() {
      _routeResult = null;
      _showRoutingPanel = false;
      _toStation = null;
      _fromText = 'Your Location';
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.transparent,
      body: Stack(
        children: [
          // Map fills everything (rendered by JS)
          const SizedBox.expand(),

          // Top routing panel
          if (_showRoutingPanel) _buildRoutingPanel(),

          // Route result card
          if (_routeResult != null) _buildRouteResultCard(),

          // Bottom sheet for station click
          if (_clickedStationName != null && !_showRoutingPanel)
            _buildStationSheet(),
        ],
      ),
    );
  }

  Widget _buildRoutingPanel() {
    return Positioned(
      top: MediaQuery.of(context).padding.top + 8,
      left: 12,
      right: 12,
      child: Material(
        elevation: 8,
        borderRadius: BorderRadius.circular(16),
        color: const Color(0xFF1E1E2E),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // Header
              Row(
                children: [
                  const Icon(Icons.directions_transit, color: Colors.orange, size: 28),
                  const SizedBox(width: 12),
                  const Text('Plan Your Route',
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.white)),
                  const Spacer(),
                  IconButton(
                    icon: const Icon(Icons.close, color: Colors.white70),
                    onPressed: _clearRoute,
                  ),
                ],
              ),
              const SizedBox(height: 12),

              // FROM field
              Container(
                decoration: BoxDecoration(
                  color: const Color(0xFF2A2A3E),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: ListTile(
                  leading: const Icon(Icons.my_location, color: Colors.green, size: 20),
                  title: Text(_fromText,
                    style: const TextStyle(color: Colors.white70, fontSize: 14)),
                  subtitle: const Text('From', style: TextStyle(color: Colors.white38, fontSize: 11)),
                  dense: true,
                ),
              ),
              const SizedBox(height: 8),

              // TO field (autocomplete dropdown)
              Container(
                decoration: BoxDecoration(
                  color: const Color(0xFF2A2A3E),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Autocomplete<String>(
                  optionsBuilder: (textEditingValue) {
                    if (textEditingValue.text.isEmpty) return _stationNames;
                    return _stationNames.where((s) =>
                      s.toLowerCase().contains(textEditingValue.text.toLowerCase()));
                  },
                  onSelected: (value) {
                    setState(() { _toStation = value; });
                  },
                  fieldViewBuilder: (context, controller, focusNode, onSubmitted) {
                    return TextField(
                      controller: controller,
                      focusNode: focusNode,
                      style: const TextStyle(color: Colors.white, fontSize: 14),
                      decoration: InputDecoration(
                        prefixIcon: const Icon(Icons.place, color: Colors.redAccent, size: 20),
                        hintText: 'Select destination station...',
                        hintStyle: const TextStyle(color: Colors.white38, fontSize: 14),
                        border: InputBorder.none,
                        contentPadding: const EdgeInsets.symmetric(vertical: 14, horizontal: 8),
                        suffixIcon: _toStation != null
                          ? IconButton(
                              icon: const Icon(Icons.clear, color: Colors.white38, size: 18),
                              onPressed: () {
                                controller.clear();
                                setState(() { _toStation = null; _routeResult = null; });
                              },
                            )
                          : null,
                      ),
                    );
                  },
                  optionsViewBuilder: (context, onSelected, options) {
                    return Align(
                      alignment: Alignment.topLeft,
                      child: Material(
                        elevation: 8,
                        borderRadius: BorderRadius.circular(12),
                        color: const Color(0xFF2A2A3E),
                        child: ConstrainedBox(
                          constraints: const BoxConstraints(maxHeight: 200, maxWidth: 350),
                          child: ListView.builder(
                            padding: EdgeInsets.zero,
                            shrinkWrap: true,
                            itemCount: options.length,
                            itemBuilder: (context, index) {
                              final option = options.elementAt(index);
                              return ListTile(
                                dense: true,
                                leading: const Icon(Icons.train, color: Colors.orange, size: 18),
                                title: Text(option,
                                  style: const TextStyle(color: Colors.white, fontSize: 13)),
                                onTap: () => onSelected(option),
                              );
                            },
                          ),
                        ),
                      ),
                    );
                  },
                ),
              ),
              const SizedBox(height: 12),

              // Calculate button
              SizedBox(
                width: double.infinity,
                child: ElevatedButton.icon(
                  onPressed: _toStation != null && !_isRouteLoading ? _calculateRoute : null,
                  icon: _isRouteLoading
                    ? const SizedBox(width: 18, height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                    : const Icon(Icons.directions),
                  label: Text(_isRouteLoading ? 'Calculating...' : 'Get Directions'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.orange,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildRouteResultCard() {
    final r = _routeResult!;
    final lineColor = r['metroLine'] == 'orange' ? Colors.orange : Colors.cyan;

    return Positioned(
      bottom: 20,
      left: 12,
      right: 12,
      child: Material(
        elevation: 8,
        borderRadius: BorderRadius.circular(16),
        color: const Color(0xFF1E1E2E),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                children: [
                  Icon(Icons.timer, color: lineColor, size: 28),
                  const SizedBox(width: 10),
                  Text('${r['totalTimeMin']} min total',
                    style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: Colors.white)),
                  const Spacer(),
                  IconButton(
                    icon: const Icon(Icons.close, color: Colors.white54),
                    onPressed: _clearRoute,
                  ),
                ],
              ),
              const Divider(color: Colors.white24),
              _routeStep(Icons.directions_walk, Colors.blue,
                'Walk to ${r['nearestStation']}',
                '${r['walkDistM']}m · ${r['walkTimeMin']} min'),
              _routeStep(Icons.train, lineColor,
                '${r['nearestStation']} → ${r['destStation']}',
                '${r['metroTimeMin']} min · ${(r['metroLine'] as String).toUpperCase()} Line'),
            ],
          ),
        ),
      ),
    );
  }

  Widget _routeStep(IconData icon, Color color, String title, String subtitle) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Container(
            width: 36, height: 36,
            decoration: BoxDecoration(color: color.withValues(alpha: 0.15), shape: BoxShape.circle),
            child: Icon(icon, color: color, size: 18),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: const TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.w500)),
                Text(subtitle, style: const TextStyle(color: Colors.white54, fontSize: 12)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStationSheet() {
    return DraggableScrollableSheet(
      initialChildSize: 0.18,
      minChildSize: 0.1,
      maxChildSize: 0.35,
      builder: (context, scrollController) {
        return Container(
          decoration: const BoxDecoration(
            color: Color(0xFF1E1E2E),
            borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
          ),
          child: ListView(
            controller: scrollController,
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 20),
            children: [
              // Drag handle
              Center(
                child: Container(
                  width: 40, height: 4,
                  margin: const EdgeInsets.only(bottom: 16),
                  decoration: BoxDecoration(
                    color: Colors.white24,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              // Station name
              Row(
                children: [
                  const Icon(Icons.train, color: Colors.orange, size: 28),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      _clickedStationName ?? '',
                      style: const TextStyle(
                        fontSize: 20, fontWeight: FontWeight.bold, color: Colors.white),
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.close, color: Colors.white54),
                    onPressed: () => setState(() { _clickedStationName = null; }),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              // Directions button
              SizedBox(
                width: double.infinity,
                child: ElevatedButton.icon(
                  onPressed: () {
                    setState(() {
                      _showRoutingPanel = true;
                      _toStation = _clickedStationName;
                      _clickedStationName = null;
                    });
                  },
                  icon: const Icon(Icons.directions),
                  label: const Text('Directions'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.orange,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}
