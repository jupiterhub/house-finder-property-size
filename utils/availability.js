const parseDateTs = (str) => {
  if (!str || typeof str !== 'string' || str === 'Unknown' || /unknown|ask agent/i.test(str)) return 0;
  if (/now|immediate|today/i.test(str)) return Date.now();
  if (/(\d{2})\/(\d{2})\/(\d{4})/.test(str)) {
    const mDate = str.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    const d = new Date(`${mDate[3]}-${mDate[2]}-${mDate[1]}`);
    if (!isNaN(d.getTime())) return d.getTime();
  }
  if (/(\d{4})-(\d{2})-(\d{2})/.test(str)) {
    const d = new Date(str);
    if (!isNaN(d.getTime())) return d.getTime();
  }
  const d = new Date(str);
  return !isNaN(d.getTime()) ? d.getTime() : 0;
};

function getDesiredAvailabilityConfig(config = {}) {
  const desiredDateStr = config.desiredLetAvailableDate ||
                         config.letAvailableDate ||
                         config.targetLetAvailableDate ||
                         config.desiredAvailabilityDate ||
                         config.desiredAvailabilityDateStart ||
                         config.availabilityDateStart ||
                         config.targetDate ||
                         config.minAvailabilityDate ||
                         null;

  const windowDays = config.availabilityWindowDays !== undefined ? config.availabilityWindowDays :
                     (config.availabilityWindow !== undefined ? config.availabilityWindow : 7);

  const filterAvailableNow = config.filterAvailableNow !== undefined ? config.filterAvailableNow :
                             (config.includeAvailableNow !== undefined ? !config.includeAvailableNow : !!desiredDateStr);

  const includeUnknownAvailability = config.includeUnknownAvailability !== undefined ? config.includeUnknownAvailability : true;

  return {
    desiredDateStr,
    desiredTs: desiredDateStr ? parseDateTs(desiredDateStr) : 0,
    windowDays,
    filterAvailableNow,
    includeUnknownAvailability
  };
}

function isDesiredAvailability(letAvailableStr, config = {}) {
  const {
    desiredDateStr,
    desiredTs,
    windowDays,
    filterAvailableNow,
    includeUnknownAvailability
  } = getDesiredAvailabilityConfig(config);

  if (!desiredDateStr || desiredTs === 0) {
    return { kept: true, reason: null };
  }

  const str = String(letAvailableStr || 'Unknown').trim();

  // Handle Unknown / Ask agent
  if (!str || str === 'Unknown' || /unknown|ask agent/i.test(str)) {
    if (!includeUnknownAvailability) {
      return { kept: false, reason: `Availability Unknown (filtered out for desired date ${desiredDateStr})` };
    }
    return { kept: true, reason: null };
  }

  // Handle Now / Immediate / Today
  if (/now|immediate|today/i.test(str)) {
    if (filterAvailableNow) {
      return { kept: false, reason: `Available Now (filtered out for desired date ${desiredDateStr})` };
    }
    return { kept: true, reason: null };
  }

  const availTs = parseDateTs(str);
  if (availTs === 0) {
    if (!includeUnknownAvailability) {
      return { kept: false, reason: `Availability unrecognized (${str}, filtered out for desired date ${desiredDateStr})` };
    }
    return { kept: true, reason: null };
  }

  // Check against desired availability date start minus windowDays tolerance
  const windowMs = (windowDays || 0) * 24 * 60 * 60 * 1000;
  const minAcceptableTs = desiredTs - windowMs;

  if (availTs < minAcceptableTs) {
    return {
      kept: false,
      reason: `Available ${str} (too early for desired date ${desiredDateStr}, tolerance ±${windowDays}d)`
    };
  }

  return { kept: true, reason: null };
}

module.exports = {
  parseDateTs,
  getDesiredAvailabilityConfig,
  isDesiredAvailability
};
