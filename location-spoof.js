/**
 * aClicker — Location Spoofing (Main World Context)
 *
 * Runs in the page's execution context (world: "MAIN") to access
 * AngularJS services and page-level variables directly.
 */

(function () {
  "use strict";

  if (window.__aclicker_location_spoof_initialized) return;
  window.__aclicker_location_spoof_initialized = true;

  // ─── Constants & State ──────────────────────────────────────────────────────

  const DEFAULT_COORDS = Object.freeze({
    lat: 40.2081392,
    lon: -85.4085399,
    accuracy: 15.849,
  });

  const DUMMY_GEO_REQUEST = Object.freeze({
    geo: { accuracy: DEFAULT_COORDS.accuracy, lat: DEFAULT_COORDS.lat, lon: DEFAULT_COORDS.lon },
    publicIP: null,
    auto: false,
  });

  let isEnabled = false;

  /**
   * Determine if location spoofing is active.
   * Checks both DOM dataset attribute (set synchronously by content.js)
   * and the internal state variable (updated via postMessage).
   * @returns {boolean}
   */
  function isSpoofEnabled() {
    const datasetSpoof = document.documentElement?.dataset?.aclickerSpoof;
    if (datasetSpoof !== undefined) {
      return datasetSpoof === "true";
    }
    return isEnabled;
  }

  // Listen for toggle updates from content.js
  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data) return;
    if (event.data.type === "ACLICKER_SET_SPOOF_LOCATION") {
      isEnabled = !!event.data.enabled;
      console.log("[aClicker] Location spoofing toggle set to:", isEnabled);
    }
  });

  // ─── Angular Helpers ────────────────────────────────────────────────────────

  /**
   * Safely retrieve the AngularJS injector if present.
   * @returns {any|null}
   */
  function getAngularInjector() {
    const ng = window.angular || (typeof angular !== "undefined" ? angular : null);
    if (!ng || !document.body) return null;
    try {
      const bodyEl = ng.element(document.body);
      return bodyEl?.injector ? bodyEl.injector() : null;
    } catch {
      return null;
    }
  }

  function getActiveCourseId() {
    return (
      sessionStorage.getItem("course_id") ||
      sessionStorage.getItem("courseId") ||
      null
    );
  }

  function getSpoofedCoords(targetCourseId) {
    const cid = targetCourseId || getActiveCourseId();
    if (cid) {
      const stored = localStorage.getItem(cid);
      if (stored) {
        const parts = stored.split(":");
        const lat = parseFloat(parts[0]);
        const lon = parseFloat(parts[1]);
        if (!isNaN(lat) && !isNaN(lon)) {
          return { lat, lon, accuracy: DEFAULT_COORDS.accuracy };
        }
      }
    }
    return { ...DEFAULT_COORDS };
  }

  // ─── 1. Geolocation API Interception ───────────────────────────────────────

  const originalGetCurrentPosition =
    navigator.geolocation?.getCurrentPosition?.bind(navigator.geolocation);
  const originalWatchPosition =
    navigator.geolocation?.watchPosition?.bind(navigator.geolocation);

  function createPositionObject(coords) {
    return {
      coords: {
        latitude: coords.lat,
        longitude: coords.lon,
        accuracy: coords.accuracy,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
      },
      timestamp: Date.now(),
    };
  }

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition = function (
      success,
      error,
      options
    ) {
      if (!isSpoofEnabled()) {
        return originalGetCurrentPosition
          ? originalGetCurrentPosition(success, error, options)
          : error?.({ code: 1, message: "User denied Geolocation" });
      }

      const coords = getSpoofedCoords();
      console.log(
        "[aClicker] Spoofing navigator.geolocation.getCurrentPosition:",
        { lat: coords.lat, lon: coords.lon }
      );
      const position = createPositionObject(coords);
      setTimeout(() => {
        if (typeof success === "function") success(position);
      }, 0);
    };

    navigator.geolocation.watchPosition = function (
      success,
      error,
      options
    ) {
      if (!isSpoofEnabled()) {
        return originalWatchPosition
          ? originalWatchPosition(success, error, options)
          : 0;
      }

      const coords = getSpoofedCoords();
      const position = createPositionObject(coords);
      setTimeout(() => {
        if (typeof success === "function") success(position);
      }, 0);
      return Math.floor(Math.random() * 100000) + 1;
    };
  }

  // ─── 2. Fetch / Set Class Instructor Geo ────────────────────────────────────

  /**
   * Request instructor geo data from iClicker attendance API.
   * @param {string} [targetCourseId]
   * @returns {Promise<string|null>}
   */
  const setClassLocation = async (targetCourseId) => {
    const courseId = targetCourseId || getActiveCourseId();
    if (!courseId) {
      console.warn("[aClicker] No course ID found for location spoofing.");
      return null;
    }

    const existingCoords = localStorage.getItem(courseId);
    if (existingCoords) {
      console.log("Not setting class location, local storage item exists");
      return existingCoords;
    }

    const injector = getAngularInjector();
    if (!injector) {
      console.warn(
        "[aClicker] Angular injector not available to fetch instructor location."
      );
      return null;
    }

    console.log("Getting instructor geo location data");
    return new Promise((resolve) => {
      try {
        injector.invoke([
          "ExpressRouterService",
          function (router) {
            const req = router.post(
              `/api/courses/${courseId}/attendance/join`,
              { ...DUMMY_GEO_REQUEST, id: courseId }
            );

            req
              .then((data) => {
                const loc =
                  data?.data?.instructorLocation || data?.instructorLocation;
                if (loc && loc.lat !== undefined && loc.lon !== undefined) {
                  const coords = `${loc.lat}:${loc.lon}`;
                  localStorage.setItem(courseId, coords);
                  console.log("Set instructor geo location data");
                  resolve(coords);
                } else {
                  console.warn(
                    "[aClicker] instructorLocation not returned in response:",
                    data
                  );
                  resolve(null);
                }
              })
              .catch((err) => {
                console.warn(
                  "[aClicker] Failed to get instructor location:",
                  err
                );
                resolve(null);
              });
          },
        ]);
      } catch (err) {
        console.error("[aClicker] Error invoking ExpressRouterService:", err);
        resolve(null);
      }
    });
  };

  // Expose setClassLocation on window for debugging / direct invocation
  window.setClassLocation = setClassLocation;

  // ─── 3. Hook AngularJS Services ─────────────────────────────────────────────

  let servicesHooked = false;

  function hookAngularServices() {
    const injector = getAngularInjector();
    if (!injector) return false;

    try {
      // 3a. Hook ExpressRouterService and Courses
      injector.invoke([
        "ExpressRouterService",
        "Courses",
        function (router, Courses) {
          if (!Courses || Courses.__aclicker_spoof_hooked) return;
          Courses.__aclicker_spoof_hooked = true;

          const originalJoinAttendanceSession =
            Courses.joinAttendanceSession;

          Courses.joinAttendanceSession = function (payload, courseId) {
            if (!isSpoofEnabled()) {
              return originalJoinAttendanceSession
                ? originalJoinAttendanceSession.apply(this, arguments)
                : router.post(`/api/courses/${courseId}/attendance/join`, payload);
            }

            console.log("Posting student geo location data");
            const storedCoords = localStorage.getItem(courseId);

            let lat, lon;
            if (storedCoords) {
              const parts = storedCoords.split(":");
              lat = parseFloat(parts[0]);
              lon = parseFloat(parts[1]);
            } else {
              console.log(
                "Location data does not exist for class. Setting data ( will require you to join again )."
              );
              setClassLocation(courseId);
              lat = payload?.geo?.lat ?? DEFAULT_COORDS.lat;
              lon = payload?.geo?.lon ?? DEFAULT_COORDS.lon;
            }

            if (payload?.geo) {
              payload.geo.lat = lat;
              payload.geo.lon = lon;
            }

            return router.post(
              `/api/courses/${courseId}/attendance/join`,
              payload
            );
          };

          console.log(
            "[aClicker] Successfully hooked Courses.joinAttendanceSession"
          );
        },
      ]);

      // 3b. Hook joinSessionService
      injector.invoke([
        "joinSessionService",
        function (jSS) {
          if (!jSS || jSS.__aclicker_spoof_hooked) return;
          jSS.__aclicker_spoof_hooked = true;

          const originalJoinSession = jSS.joinSession;

          jSS.joinSession = function (e, courseId, n) {
            if (!isSpoofEnabled()) {
              return originalJoinSession.apply(this, arguments);
            }

            return setClassLocation(courseId).then(() => {
              console.log("joining class");
              return originalJoinSession.apply(this, [e, courseId, n]);
            });
          };

          console.log(
            "[aClicker] Successfully hooked joinSessionService.joinSession"
          );
        },
      ]);

      return true;
    } catch {
      // Angular may still be bootstrapping its module injector
      return false;
    }
  }

  // ─── 4. Bootstrap Polling ───────────────────────────────────────────────────

  function attemptHook() {
    if (servicesHooked) return;
    if (hookAngularServices()) {
      servicesHooked = true;
      console.log("[aClicker] All location spoofing hooks installed.");
    }
  }

  attemptHook();

  const hookInterval = setInterval(() => {
    attemptHook();
    if (servicesHooked) clearInterval(hookInterval);
  }, 250);

  // Stop polling after 30s to prevent unnecessary CPU cycles if not on an Angular page
  setTimeout(() => clearInterval(hookInterval), 30000);

  // Re-check on SPA navigation
  window.addEventListener("hashchange", attemptHook);
  window.addEventListener("popstate", attemptHook);
})();
