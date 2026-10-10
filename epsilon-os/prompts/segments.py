"""Per-segment search briefs for prospect_research.md. Plain text: what unmet, current need looks like."""

SEGMENT_BRIEFS = {
    "industrial": (
        "Industrial operations anywhere in the world running legacy or undocumented equipment: mills, plants, "
        "cold chain, generators, packaging and process lines, small utilities.\n"
        "Look for: job posts for PLC, SCADA, HMI, controls, embedded or firmware engineers at small and mid-sized "
        "manufacturers; tenders, RFQs and RFPs for monitoring, data logging, retrofits or remote visibility; "
        "forum, Reddit or Stack Exchange threads where an operator describes a machine whose protocol or "
        "controller is undocumented or whose vendor is gone; small manufacturers announcing a new line, "
        "plant or expansion with no named automation integrator; calls for suppliers for sensors, energy "
        "or condition monitoring.\n"
        "Best source: company job boards on applicant-tracking sites, which are dated and name the employer: site:boards.greenhouse.io, site:jobs.lever.co, site:apply.workable.com, site:jobs.ashbyhq.com, site:recruitee.com with \"controls engineer\" OR \"PLC\" OR \"SCADA\" OR \"automation engineer\" plus manufacturing, food, packaging, cold storage or plant. "
        "Example searches to adapt: \"hiring PLC SCADA engineer\" with a plant or packaging term; "
        "\"request for quotation\" \"remote monitoring\" OR \"data logger\" OR \"retrofit\"; Reddit r/PLC or "
        "r/industrialautomation \"no documentation\" \"old controller\" \"vendor gone\"; \"new production line\" "
        "\"commissioning\" small manufacturer press release."),
    "oem_hardware": (
        "OEMs and hardware startups with a product in development or in the field.\n"
        "Look for: startups with a hardware product hiring or asking for firmware, embedded or PCB help; public "
        "posts about firmware that half-works, a board respin, a product failing in the field or a supplier "
        "going end-of-life; forum or Stack Exchange questions about an undocumented serial, CAN, Modbus or "
        "proprietary protocol on a device the company sells or integrates; requests from OEMs for pre-fab design "
        "review or help with a datasheet-to-footprint backlog; crowdfunding or launch announcements for "
        "hardware with no named engineering partner.\n"
        "Example searches to adapt: \"firmware engineer\" hiring hardware startup seed; Stack Exchange "
        "electronics \"proprietary protocol\" \"reverse engineer\" \"serial\" device; \"PCB respin\" OR "
        "\"board bring-up\" help wanted; Kickstarter OR Crowd Supply hardware \"firmware\" \"looking for\"."),
    "smb_software": (
        "Small and mid-sized businesses (retail, clinics, logistics, education, hospitality, trades, local "
        "services, small manufacturers) that need software they do not have.\n"
        "Look for: job posts or freelance requests for a dashboard, inventory system, CRM, booking system, "
        "quoting tool, mobile app or marketplace at a company with no software team; posts on business forums, "
        "Reddit or Stack Exchange where an owner describes running the business on spreadsheets or paper and "
        "asks what to use; tenders or RFQs for such systems from small organisations; companies announcing a "
        "new location, product line or online service without a named software vendor.\n"
        "Best source: small non-software companies hiring their first developer, an internal-tools developer or an operations analyst to automate spreadsheets, on applicant-tracking sites that name the employer: site:apply.workable.com, site:recruitee.com, site:bamboohr.com, site:jobs.lever.co with \"internal tools\" OR \"automate\" OR \"spreadsheets\" OR \"inventory system\" OR \"CRM\" and a non-tech industry (distribution, logistics, clinic, hospitality, manufacturing, retail). Skip software companies. "
        "Example searches to adapt: \"looking for\" \"inventory management\" OR \"booking system\" OR \"CRM\" "
        "small business developer wanted; Reddit r/smallbusiness OR r/sysadmin \"we use spreadsheets\" "
        "\"need software\"; \"request for proposal\" \"inventory\" OR \"scheduling\" OR \"customer portal\" "
        "small clinic OR school OR distributor."),
}
