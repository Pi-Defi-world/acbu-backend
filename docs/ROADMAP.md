# ACBU Roadmap

This document outlines the ACBU platform development roadmap with committed timelines, owners, dependencies, and acceptance criteria for each phase.

## Overview

The ACBU platform is being developed in phases to ensure security, compliance, and operational readiness before mainnet launch. Each phase has clear ownership, hard dates, and acceptance criteria.

## Phase 1: Foundation and Infrastructure

**Status**: ✅ Completed
**Owner**: Infrastructure Team
**Timeline**: Q1 2025 (Jan 1 - Mar 31, 2025)
**Dependencies**: None

### Objectives
- Establish core infrastructure components
- Set up development and staging environments
- Implement CI/CD pipelines
- Configure monitoring and logging

### Deliverables
- [x] Cloud infrastructure setup (AWS/GCP)
- [x] Database architecture (PostgreSQL + MongoDB Atlas)
- [x] Message queue configuration (RabbitMQ)
- [x] CI/CD pipeline (GitHub Actions)
- [x] Monitoring and alerting (Prometheus/Grafana)
- [x] Logging infrastructure (Winston)

### Acceptance Criteria
- [x] All infrastructure components deployed and operational
- [x] CI/CD pipeline passing all builds
- [x] Monitoring dashboards configured and alerting tested
- [x] Disaster recovery procedures documented
- [x] Security baseline (firewall, IAM, encryption) implemented

## Phase 2: Core Backend Services

**Status**: ✅ Completed
**Owner**: Backend Team
**Timeline**: Q2 2025 (Apr 1 - Jun 30, 2025)
**Dependencies**: Phase 1 completed

### Objectives
- Implement core business logic services
- Build API endpoints
- Integrate with fintech partners
- Implement KYC/AML workflows

### Deliverables
- [x] User authentication and authorization
- [x] Wallet management (Stellar integration)
- [x] Transaction processing (mint/burn/transfer)
- [x] KYC document upload and validation
- [x] Fintech partner integrations (Flutterwave, Paystack, MTN MoMo)
- [x] Reserve management and monitoring

### Acceptance Criteria
- [x] All core services unit tested with >80% coverage
- [x] API documentation complete (Swagger/OpenAPI)
- [x] Integration tests with fintech partners passing
- [x] KYC/AML compliance checks implemented
- [x] Rate limiting and security middleware in place
- [x] Audit logging for all financial transactions

## Phase 3: Smart Contract Development

**Status**: In Progress
**Owner**: Smart Contracts Team
**Timeline**: Q3 2025 (Jul 1 - Sep 30, 2025)
**Dependencies**: Phase 2 completed

### Objectives
- Develop and test Soroban smart contracts
- Implement minting and burning contracts
- Build reserve tracker contract
- Implement savings vault and lending pool contracts

### Deliverables
- [ ] Minting contract (CONTRACT_MINTING)
- [ ] Burning contract (CONTRACT_BURNING)
- [ ] Reserve tracker contract (CONTRACT_RESERVE_TRACKER)
- [ ] Oracle contract (CONTRACT_ORACLE)
- [ ] Savings vault contract (CONTRACT_SAVINGS_VAULT)
- [ ] Lending pool contract (CONTRACT_LENDING_POOL)
- [ ] Escrow contract (CONTRACT_ESCROW)

### Acceptance Criteria
- [ ] All contracts unit tested (Rust)
- [ ] Integration tests with backend passing
- [ ] **Security audit completed by external firm**
- [ ] Audit findings addressed and verified
- [ ] Gas optimization completed
- [ ] Contract documentation complete
- [ ] Testnet deployment and validation

### External Audit Gate
- **Audit Firm**: TBD
- **Audit Deadline**: August 15, 2025
- **Remediation Deadline**: September 15, 2025
- **Acceptance**: Audit report with no critical findings

## Phase 4: Compliance and Security Hardening

**Status**: Pending
**Owner**: Compliance & Security Team
**Timeline**: Q4 2025 (Oct 1 - Dec 31, 2025)
**Dependencies**: Phase 3 completed, Phase 3 audit passed

### Objectives
- Implement Travel Rule compliance
- Implement jurisdiction licensing checks
- Complete security audit
- Obtain required regulatory licenses

### Deliverables
- [ ] Travel Rule compliance (#1142)
- [ ] Jurisdiction licensing validation (#1143)
- [ ] PII encryption at rest
- [ ] Key management system (KMS)
- [ ] Security audit (backend + infrastructure)
- [ ] Regulatory license applications (Rwanda + target jurisdictions)

### Acceptance Criteria
- [ ] Travel Rule checks implemented and tested
- [ ] Jurisdiction licensing checks implemented and tested
- [ ] All PII encrypted with AES-256-GCM
- [ ] Keys rotated quarterly
- [ ] **Security audit completed by external firm**
- [ ] Audit findings addressed and verified
- [ ] At least one regulatory license obtained (Rwanda)
- [ ] Legal review of compliance documentation

### External Audit Gate
- **Audit Firm**: TBD
- **Audit Deadline**: November 15, 2025
- **Remediation Deadline**: December 15, 2025
- **Acceptance**: Audit report with no critical findings

## Phase 5: Testnet Beta

**Status**: Pending
**Owner**: Product & QA Team
**Timeline**: Q1 2026 (Jan 1 - Mar 31, 2026)
**Dependencies**: Phase 4 completed, Phase 4 audit passed

### Objectives
- Deploy to Stellar testnet
- Onboard beta users
- Test end-to-end workflows
- Gather feedback and iterate

### Deliverables
- [ ] Testnet deployment
- [ ] Beta user onboarding (100 users)
- [ ] Load testing (1,000 concurrent users)
- [ ] Bug bounty program launch
- [ ] User feedback collection and analysis
- [ ] Performance optimization

### Acceptance Criteria
- [ ] Testnet stable for 30 days
- [ ] All critical bugs resolved
- [ ] Average response time <200ms
- [ ] 99.9% uptime during beta
- [ ] Beta user satisfaction >4.0/5.0
- [ ] Security incidents = 0
- [ ] Compliance monitoring operational

## Phase 6: Mainnet Launch

**Status**: Pending
**Owner**: Launch Team
**Timeline**: Q2 2026 (Apr 1 - Jun 30, 2026)
**Dependencies**: Phase 5 completed, all audits passed, licenses obtained

### Objectives
- Deploy to Stellar mainnet
- Launch production services
- Implement incident response procedures
- Begin mainnet operations

### Deliverables
- [ ] Mainnet deployment
- [ ] Production monitoring and alerting
- [ ] Incident response runbooks
- [ ] Disaster recovery tested
- [ ] Customer support procedures
- [ ] Public launch announcement

### Acceptance Criteria
- [ ] **All external audits passed** (contracts + security)
- [ ] **All required regulatory licenses obtained**
- [ ] Security penetration test completed
- [ ] Disaster recovery drill successful
- [ ] 24/7 monitoring operational
- [ ] Customer support team trained
- [ ] Legal review of launch materials
- [ ] Insurance coverage in place

### Pre-Launch Gate Checklist
- [ ] Contract audit passed (Phase 3)
- [ ] Security audit passed (Phase 4)
- [ ] Rwanda license obtained
- [ ] Target jurisdiction licenses or partner agreements in place
- [ ] Travel Rule compliance verified
- [ ] Jurisdiction licensing verified
- [ ] Third-party security review completed
- [ ] Bug bounty program operational
- [ ] Incident response team on call
- [ ] Legal sign-off obtained

## Phase 7: Post-Launch Optimization

**Status**: Pending
**Owner**: Product Team
**Timeline**: Q3 2026 (Jul 1 - Sep 30, 2026)
**Dependencies**: Phase 6 completed

### Objectives
- Scale infrastructure based on load
- Implement advanced features
- Expand to additional jurisdictions
- Optimize costs and performance

### Deliverables
- [ ] Auto-scaling infrastructure
- [ ] Advanced trading features
- [ ] Additional fintech partners
- [ ] Multi-jurisdiction expansion
- [ ] Cost optimization

### Acceptance Criteria
- [ ] Support 10,000 concurrent users
- [ ] Average response time <100ms
- [ ] 99.99% uptime
- [ ] 3 additional jurisdictions launched
- [ ] Cost per transaction reduced by 20%

## Dependency Graph

```
Phase 1 (Foundation)
    ↓
Phase 2 (Core Services)
    ↓
Phase 3 (Smart Contracts) → [Audit Gate] →
    ↓
Phase 4 (Compliance & Security) → [Audit Gate] →
    ↓
Phase 5 (Testnet Beta)
    ↓
Phase 6 (Mainnet Launch) → [Pre-Launch Gate] →
    ↓
Phase 7 (Post-Launch Optimization)
```

## Risk Mitigation

### Critical Risks
1. **Audit delays**: External audits may take longer than expected
   - Mitigation: Schedule audits 2 months ahead of gate deadlines
   - Contingency: Buffer time for remediation built into timeline

2. **License delays**: Regulatory licenses may be delayed
   - Mitigation: Submit applications early (Phase 4)
   - Contingency: Partner model for unlicensed jurisdictions

3. **Security incidents**: Vulnerabilities discovered during audits
   - Mitigation: Continuous security testing
   - Contingency: Emergency remediation team on standby

4. **Infrastructure scaling**: System may not handle anticipated load
   - Mitigation: Load testing in Phase 5
   - Contingency: Auto-scaling infrastructure ready

## Owners and Responsibilities

| Phase | Owner | Contact | Backup Owner |
|-------|-------|---------|--------------|
| Phase 1 | Infrastructure Team | infra@acbu.com | DevOps Lead |
| Phase 2 | Backend Team | backend@acbu.com | Tech Lead |
| Phase 3 | Smart Contracts Team | contracts@acbu.com | Blockchain Lead |
| Phase 4 | Compliance & Security Team | compliance@acbu.com | CTO |
| Phase 5 | Product & QA Team | product@acbu.com | QA Lead |
| Phase 6 | Launch Team | launch@acbu.com | CEO |
| Phase 7 | Product Team | product@acbu.com | CPO |

## Milestone Tracking

| Milestone | Target Date | Actual Date | Status | Notes |
|-----------|-------------|-------------|--------|-------|
| Phase 1 Complete | Mar 31, 2025 | Mar 28, 2025 | ✅ | Completed early |
| Phase 2 Complete | Jun 30, 2025 | Jun 25, 2025 | ✅ | Completed early |
| Phase 3 Complete | Sep 30, 2025 | - | 🔄 | In progress |
| Phase 3 Audit Complete | Aug 15, 2025 | - | ⏳ | Pending |
| Phase 4 Complete | Dec 31, 2025 | - | ⏳ | Pending |
| Phase 4 Audit Complete | Nov 15, 2025 | - | ⏳ | Pending |
| Phase 5 Complete | Mar 31, 2026 | - | ⏳ | Pending |
| Phase 6 Complete | Jun 30, 2026 | - | ⏳ | Pending |
| Phase 7 Complete | Sep 30, 2026 | - | ⏳ | Pending |

## References

- Issue: #1144 - Roadmap lacks committed timelines, owners, and milestone acceptance criteria
- Travel Rule Compliance: docs/TRAVEL_RULE_COMPLIANCE.md
- Jurisdiction Licensing: docs/JURISDICTION_LICENSING.md
- Stellar Security: docs/STELLAR_SECURITY.md
- Audit Documentation: audit/README.md

## Updates

This roadmap should be reviewed and updated quarterly. Any changes to timelines, owners, or acceptance criteria must be approved by the CTO and CEO.
