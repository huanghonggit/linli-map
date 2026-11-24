const streetFiles = {
  1193684637752085: "zhou-ruihe",
  761926911164262: "zhou-ruian",
  164549105530999: "zhoujian-ruihe",
};
export const streetFile = (p) =>
  p.streetPhoto ? `/recognition/${streetFiles[p.streetPhoto]}.webp` : null;

